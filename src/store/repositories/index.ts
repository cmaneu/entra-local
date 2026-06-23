import type { Database } from '../db.js';
import type { Clock } from '../util.js';
import { createAppsRepository, type AppsRepository } from './apps.js';
import { createAuthCodesRepository, type AuthCodesRepository } from './authCodes.js';
import { createGroupsRepository, type GroupsRepository } from './groups.js';
import { createRefreshTokensRepository, type RefreshTokensRepository } from './refreshTokens.js';
import { createSessionsRepository, type SessionsRepository } from './sessions.js';
import { createSigningKeysRepository, type SigningKeysRepository } from './signingKeys.js';
import { createTenantsRepository, type TenantsRepository } from './tenants.js';
import { createUsersRepository, type UsersRepository } from './users.js';

/** The full set of synchronous repositories over a single SQLite connection. */
export interface Repositories {
  tenants: TenantsRepository;
  users: UsersRepository;
  groups: GroupsRepository;
  apps: AppsRepository;
  signingKeys: SigningKeysRepository;
  authCodes: AuthCodesRepository;
  refreshTokens: RefreshTokensRepository;
  sessions: SessionsRepository;
}

/** Build all repositories sharing one connection and clock. */
export function createRepositories(db: Database, clock: Clock): Repositories {
  return {
    tenants: createTenantsRepository(db, clock),
    users: createUsersRepository(db, clock),
    groups: createGroupsRepository(db, clock),
    apps: createAppsRepository(db, clock),
    signingKeys: createSigningKeysRepository(db, clock),
    authCodes: createAuthCodesRepository(db, clock),
    refreshTokens: createRefreshTokensRepository(db, clock),
    sessions: createSessionsRepository(db, clock),
  };
}

export type {
  AppsRepository,
  AuthCodesRepository,
  GroupsRepository,
  RefreshTokensRepository,
  SessionsRepository,
  SigningKeysRepository,
  TenantsRepository,
  UsersRepository,
};
