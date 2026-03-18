/**
 * MigrateFun SDK — TypeScript client for the Migrate.fun platform.
 *
 * Interact with the hustle-migration Solana program to query
 * migration status, check claimable tokens, and read on-chain state.
 */

import {
  Connection,
  PublicKey,
  AccountInfo,
  GetProgramAccountsFilter,
} from "@solana/web3.js";
import { getAssociatedTokenAddress, getAccount } from "@solana/spl-token";

// ---- Constants ----

export const MIGRATION_PROGRAM_ID = new PublicKey(
  "MiGRATEn4v2r3v2r3v2r3v2r3v2r3v2r3v2r3v2r3" // Placeholder — replace with actual program ID
);

export const PLATFORM_FEE_BPS = 100; // 1% platform fee

// ---- Types ----

export enum MigrationMode {
  PROTECTED = "protected",
  UNPROTECTED = "unprotected",
}

export enum MigrationStatus {
  PENDING = "pending",
  ACTIVE = "active",
  COMPLETED = "completed",
  FINALIZED = "finalized",
  FAILED = "failed",
}

export enum SupportedAMM {
  RAYDIUM = "raydium",
  METEORA = "meteora",
  PUMPSWAP = "pumpswap",
}

export interface MigrationConfig {
  oldMint: PublicKey;
  newMint: PublicKey;
  rate: number; // New tokens per old token.
  mode: MigrationMode;
  startTime: number;
  endTime: number;
  targetAmount: number; // Minimum old tokens to migrate (protected mode).
  amm: SupportedAMM;
  admin: PublicKey;
}

export interface MigrationState {
  config: MigrationConfig;
  status: MigrationStatus;
  totalOldDeposited: number;
  totalNewClaimed: number;
  participantCount: number;
  vaultOldBalance: number;
  vaultNewBalance: number;
  lpCreated: boolean;
  lpMint: PublicKey | null;
  claimsStartAt: number;
  claimsEndAt: number; // 90 days after migration ends.
  createdAt: number;
  finalizedAt: number | null;
}

export interface ClaimableInfo {
  wallet: PublicKey;
  migration: PublicKey;
  oldTokensDeposited: number;
  newTokensClaimable: number;
  newTokensClaimed: number;
  mftTokenBalance: number;
  hasClaimed: boolean;
}

export interface MigrationSnapshot {
  wallet: PublicKey;
  balance: number;
  timestamp: number;
  eligible: boolean;
}

export interface MigrationStats {
  totalMigrations: number;
  activeMigrations: number;
  completedMigrations: number;
  totalTokensMigrated: number;
  totalParticipants: number;
}

export interface ParticipantInfo {
  wallet: PublicKey;
  deposited: number;
  claimed: number;
  mftBalance: number;
  depositedAt: number;
  claimedAt: number | null;
}

// ---- PDA Derivation ----

export function deriveMigrationPDA(
  admin: PublicKey,
  oldMint: PublicKey,
  newMint: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("migration"),
      admin.toBuffer(),
      oldMint.toBuffer(),
      newMint.toBuffer(),
    ],
    MIGRATION_PROGRAM_ID
  );
}

export function deriveVaultPDA(
  migration: PublicKey,
  mint: PublicKey,
  label: string
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(label), migration.toBuffer(), mint.toBuffer()],
    MIGRATION_PROGRAM_ID
  );
}

export function deriveParticipantPDA(
  migration: PublicKey,
  wallet: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("participant"), migration.toBuffer(), wallet.toBuffer()],
    MIGRATION_PROGRAM_ID
  );
}

export function deriveMFTPDA(migration: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("mft_mint"), migration.toBuffer()],
    MIGRATION_PROGRAM_ID
  );
}

// ---- Account Parsing ----

const MIGRATION_DISCRIMINATOR = Buffer.from("migratefn");
const PARTICIPANT_DISCRIMINATOR = Buffer.from("particip");

function parseU64(data: Buffer, offset: number): number {
  return Number(data.readBigUInt64LE(offset));
}

function parsePubkey(data: Buffer, offset: number): PublicKey {
  return new PublicKey(data.subarray(offset, offset + 32));
}

function parseMigrationState(data: Buffer): MigrationState | null {
  if (data.length < 300) return null;

  const disc = data.subarray(0, 8);
  if (!disc.equals(MIGRATION_DISCRIMINATOR)) return null;

  let offset = 8;

  const admin = parsePubkey(data, offset); offset += 32;
  const oldMint = parsePubkey(data, offset); offset += 32;
  const newMint = parsePubkey(data, offset); offset += 32;
  const rate = parseU64(data, offset); offset += 8;
  const mode = data[offset] === 0 ? MigrationMode.PROTECTED : MigrationMode.UNPROTECTED; offset += 1;
  const startTime = parseU64(data, offset); offset += 8;
  const endTime = parseU64(data, offset); offset += 8;
  const targetAmount = parseU64(data, offset); offset += 8;
  const ammByte = data[offset]; offset += 1;
  const amm = ammByte === 0 ? SupportedAMM.RAYDIUM : ammByte === 1 ? SupportedAMM.METEORA : SupportedAMM.PUMPSWAP;
  const statusByte = data[offset]; offset += 1;
  const status = [MigrationStatus.PENDING, MigrationStatus.ACTIVE, MigrationStatus.COMPLETED, MigrationStatus.FINALIZED, MigrationStatus.FAILED][statusByte] || MigrationStatus.PENDING;
  const totalOldDeposited = parseU64(data, offset); offset += 8;
  const totalNewClaimed = parseU64(data, offset); offset += 8;
  const participantCount = parseU64(data, offset); offset += 8;
  const lpCreated = data[offset] === 1; offset += 1;
  const hasLpMint = data[offset] === 1; offset += 1;
  const lpMint = hasLpMint ? parsePubkey(data, offset) : null; offset += 32;
  const claimsStartAt = parseU64(data, offset); offset += 8;
  const claimsEndAt = parseU64(data, offset); offset += 8;
  const createdAt = parseU64(data, offset); offset += 8;
  const hasFinalizedAt = data[offset] === 1; offset += 1;
  const finalizedAt = hasFinalizedAt ? parseU64(data, offset) : null;

  return {
    config: {
      oldMint,
      newMint,
      rate,
      mode,
      startTime,
      endTime,
      targetAmount,
      amm,
      admin,
    },
    status,
    totalOldDeposited,
    totalNewClaimed,
    participantCount,
    vaultOldBalance: 0, // Fetched separately.
    vaultNewBalance: 0,
    lpCreated,
    lpMint,
    claimsStartAt,
    claimsEndAt,
    createdAt,
    finalizedAt,
  };
}

function parseParticipant(data: Buffer): ParticipantInfo | null {
  if (data.length < 120) return null;

  const disc = data.subarray(0, 8);
  if (!disc.equals(PARTICIPANT_DISCRIMINATOR)) return null;

  let offset = 8;
  const wallet = parsePubkey(data, offset); offset += 32;
  const deposited = parseU64(data, offset); offset += 8;
  const claimed = parseU64(data, offset); offset += 8;
  const mftBalance = parseU64(data, offset); offset += 8;
  const depositedAt = parseU64(data, offset); offset += 8;
  const hasClaimed = data[offset] === 1; offset += 1;
  const claimedAt = hasClaimed ? parseU64(data, offset) : null;

  return { wallet, deposited, claimed, mftBalance, depositedAt, claimedAt };
}

// ---- Client ----

export class MigrateFunClient {
  private _connection: Connection;

  constructor(connection: Connection) {
    this._connection = connection;
  }

  /**
   * Fetch a migration's full on-chain state.
   */
  async getMigration(migrationPubkey: PublicKey): Promise<MigrationState | null> {
    const account = await this._connection.getAccountInfo(migrationPubkey);
    if (!account) return null;
    return parseMigrationState(account.data);
  }

  /**
   * Check how many tokens a wallet can claim from a migration.
   */
  async getClaimable(
    wallet: PublicKey,
    migration: PublicKey
  ): Promise<ClaimableInfo> {
    const [participantPDA] = deriveParticipantPDA(migration, wallet);
    const account = await this._connection.getAccountInfo(participantPDA);

    const info: ClaimableInfo = {
      wallet,
      migration,
      oldTokensDeposited: 0,
      newTokensClaimable: 0,
      newTokensClaimed: 0,
      mftTokenBalance: 0,
      hasClaimed: false,
    };

    if (!account) return info;

    const participant = parseParticipant(account.data);
    if (!participant) return info;

    info.oldTokensDeposited = participant.deposited;
    info.newTokensClaimed = participant.claimed;
    info.mftTokenBalance = participant.mftBalance;
    info.hasClaimed = participant.claimedAt !== null;

    // Compute claimable from MFT balance.
    const migrationState = await this.getMigration(migration);
    if (migrationState) {
      info.newTokensClaimable = participant.mftBalance * migrationState.config.rate;
    }

    return info;
  }

  /**
   * Get all participants for a migration.
   */
  async getParticipants(
    migration: PublicKey,
    limit: number = 100
  ): Promise<ParticipantInfo[]> {
    const accounts = await this._connection.getProgramAccounts(
      MIGRATION_PROGRAM_ID,
      {
        filters: [
          { dataSize: 120 },
          {
            memcmp: {
              offset: 8, // After discriminator.
              bytes: migration.toBase58(),
            },
          },
        ],
      }
    );

    const participants: ParticipantInfo[] = [];
    for (const { account } of accounts) {
      const parsed = parseParticipant(account.data);
      if (parsed) participants.push(parsed);
      if (participants.length >= limit) break;
    }

    return participants;
  }

  /**
   * Get all active migrations.
   */
  async getActiveMigrations(): Promise<MigrationState[]> {
    const accounts = await this._connection.getProgramAccounts(
      MIGRATION_PROGRAM_ID,
      {
        filters: [{ dataSize: 350 }], // Approximate migration account size.
      }
    );

    const migrations: MigrationState[] = [];
    for (const { account } of accounts) {
      const parsed = parseMigrationState(account.data);
      if (parsed && parsed.status === MigrationStatus.ACTIVE) {
        migrations.push(parsed);
      }
    }

    return migrations;
  }

  /**
   * Get migration progress as a percentage.
   */
  async getMigrationProgress(migration: PublicKey): Promise<{
    progress: number;
    deposited: number;
    target: number;
    participants: number;
    timeRemaining: number;
  }> {
    const state = await this.getMigration(migration);
    if (!state) {
      return { progress: 0, deposited: 0, target: 0, participants: 0, timeRemaining: 0 };
    }

    const target = state.config.targetAmount;
    const progress = target > 0
      ? Math.min(100, (state.totalOldDeposited / target) * 100)
      : 100;

    const now = Math.floor(Date.now() / 1000);
    const timeRemaining = Math.max(0, state.config.endTime - now);

    return {
      progress: Math.round(progress * 100) / 100,
      deposited: state.totalOldDeposited,
      target,
      participants: state.participantCount,
      timeRemaining,
    };
  }

  /**
   * Check if the claims window is open for a migration.
   */
  async isClaimWindowOpen(migration: PublicKey): Promise<boolean> {
    const state = await this.getMigration(migration);
    if (!state) return false;

    const now = Math.floor(Date.now() / 1000);
    return now >= state.claimsStartAt && now <= state.claimsEndAt;
  }

  /**
   * Get vault balances for a migration.
   */
  async getVaultBalances(migration: PublicKey): Promise<{
    oldVault: number;
    newVault: number;
  }> {
    const state = await this.getMigration(migration);
    if (!state) return { oldVault: 0, newVault: 0 };

    const [oldVaultPDA] = deriveVaultPDA(migration, state.config.oldMint, "old_vault");
    const [newVaultPDA] = deriveVaultPDA(migration, state.config.newMint, "new_vault");

    let oldBalance = 0;
    let newBalance = 0;

    try {
      const oldAccount = await getAccount(this._connection, oldVaultPDA);
      oldBalance = Number(oldAccount.amount);
    } catch {}

    try {
      const newAccount = await getAccount(this._connection, newVaultPDA);
      newBalance = Number(newAccount.amount);
    } catch {}

    return { oldVault: oldBalance, newVault: newBalance };
  }
}

// ---- Exports ----

export default MigrateFunClient;
