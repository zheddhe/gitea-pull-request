import * as vscode from "vscode";
import { normalizeGiteaInstanceUrl } from "../context/giteaInstanceResolver";

export interface GiteaAccount {
  serverUrl: string;
  token: string;
  username: string;
  label: string;
  authMethod: "pat";
}

interface StoredAccountMetadata {
  username: string;
  label: string;
  authMethod?: "pat";
}

const SECRET_KEY_PREFIX = "gitea.token.";
const ACCOUNT_MAP_KEY = "gitea.accounts";

export class AuthManager {
  private _onDidChangeSession = new vscode.EventEmitter<void>();
  readonly onDidChangeSession = this._onDidChangeSession.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  async initialize(): Promise<void> {
    await this.migrateLegacyInstanceKeys();
  }

  async signIn(serverUrl: string, token: string): Promise<GiteaAccount> {
    const normalized = requireInstanceUrl(serverUrl);
    const response = await fetch(`${normalized}/api/v1/user`, {
      headers: { Authorization: `token ${token}` },
    });
    if (!response.ok) {
      throw new Error(
        `Authentication failed: ${response.status} ${response.statusText}`,
      );
    }
    const user = (await response.json()) as { login: string };
    const account: GiteaAccount = {
      serverUrl: normalized,
      token,
      username: user.login,
      label: `${user.login} @ ${normalized}`,
      authMethod: "pat",
    };
    await this.context.secrets.store(secretKey(normalized), token);
    const accounts = this.getAccountMap();
    accounts[normalized] = {
      username: user.login,
      label: account.label,
      authMethod: "pat",
    };
    await this.context.globalState.update(ACCOUNT_MAP_KEY, accounts);
    this._onDidChangeSession.fire();
    return account;
  }

  async signOut(serverUrl?: string): Promise<void> {
    const accounts = this.getAccountMap();
    if (serverUrl) {
      const normalized = requireInstanceUrl(serverUrl);
      await this.context.secrets.delete(secretKey(normalized));
      delete accounts[normalized];
    } else {
      for (const url of Object.keys(accounts)) {
        await this.context.secrets.delete(secretKey(url));
        delete accounts[url];
      }
    }
    await this.context.globalState.update(ACCOUNT_MAP_KEY, accounts);
    this._onDidChangeSession.fire();
  }

  async getSession(serverUrl?: string): Promise<GiteaAccount | undefined> {
    const accounts = this.getAccountMap();
    const urls = serverUrl
      ? [normalizeGiteaInstanceUrl(serverUrl)].filter(
          (url): url is string => !!url,
        )
      : Object.keys(accounts);
    for (const url of urls) {
      const token = await this.context.secrets.get(secretKey(url));
      if (token && accounts[url]) {
        return {
          serverUrl: url,
          token,
          username: accounts[url].username,
          label: accounts[url].label,
          authMethod: accounts[url].authMethod ?? "pat",
        };
      }
    }
    return undefined;
  }

  getAccountMap(): Record<string, StoredAccountMetadata> {
    return (
      this.context.globalState.get<Record<string, StoredAccountMetadata>>(
        ACCOUNT_MAP_KEY,
      ) ?? {}
    );
  }

  getServerUrls(): string[] {
    return Object.keys(this.getAccountMap());
  }

  private async migrateLegacyInstanceKeys(): Promise<void> {
    const accounts = this.getAccountMap();
    let changed = false;

    for (const legacyUrl of Object.keys(accounts)) {
      const canonicalUrl = normalizeGiteaInstanceUrl(legacyUrl);
      if (!canonicalUrl || canonicalUrl === legacyUrl) continue;

      const legacyToken = await this.context.secrets.get(secretKey(legacyUrl));
      const canonicalToken = await this.context.secrets.get(secretKey(canonicalUrl));
      if (legacyToken && !canonicalToken) {
        await this.context.secrets.store(secretKey(canonicalUrl), legacyToken);
      }
      if (legacyToken) await this.context.secrets.delete(secretKey(legacyUrl));

      if (!accounts[canonicalUrl]) {
        const metadata = accounts[legacyUrl];
        accounts[canonicalUrl] = {
          ...metadata,
          label: `${metadata.username} @ ${canonicalUrl}`,
          authMethod: metadata.authMethod ?? "pat",
        };
      }
      delete accounts[legacyUrl];
      changed = true;
    }

    if (changed) {
      await this.context.globalState.update(ACCOUNT_MAP_KEY, accounts);
    }
  }
}

export function secretKey(serverUrl: string): string {
  return `${SECRET_KEY_PREFIX}${requireInstanceUrl(serverUrl)}`;
}

function requireInstanceUrl(serverUrl: string): string {
  const normalized = normalizeGiteaInstanceUrl(serverUrl);
  if (!normalized) throw new Error(`Invalid Gitea server URL: ${serverUrl}`);
  return normalized;
}
