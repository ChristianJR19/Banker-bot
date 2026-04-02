# MigrateFun SDK

TypeScript SDK for the [Migrate.fun](https://migrate.fun) token migration platform on Solana.

Built for interacting with the `hustle-migration` program — creating migrations, managing snapshots, claiming tokens, and monitoring migration status.

## Install

```bash
npm install migratefun-sdk
```

## Usage

```typescript
import { MigrateFunClient, MigrationConfig } from 'migratefun-sdk';
import { Connection, PublicKey } from '@solana/web3.js';

const connection = new Connection('https://api.mainnet-beta.solana.com');
const client = new MigrateFunClient(connection);

// Get migration details
const migration = await client.getMigration(new PublicKey('...'));
console.log(migration.status, migration.progress);

// Check claimable tokens
const claimable = await client.getClaimable(walletPubkey, migrationPubkey);
console.log(`Claimable: ${claimable.amount} tokens`);
```

## Features

- Query migration status, progress, and configuration
- Check claimable token amounts for any wallet
- Monitor migration snapshots and participant counts
- Read program accounts (vaults, claims, LP positions)
- Full TypeScript types for all on-chain data structures

## Program

Migration program: `hustle-migration` on Solana mainnet.

Audited by [Halborn](https://www.halborn.com/audits/emblem-vault/migratefun-8ad34b).

## Links

- Platform: [migrate.fun](https://migrate.fun)
- Docs: [docs.emblem.wiki/migratefun](https://docs.emblem.wiki/migratefun)
- Emblem Vault: [emblemvault.ai](https://emblemvault.ai)

## License

MIT
