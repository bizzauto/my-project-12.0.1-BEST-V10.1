declare module 'imap' {
  interface ImapConfig {
    user: string;
    password: string;
    host: string;
    port: number;
    tls?: boolean;
    tlsOptions?: any;
    authTimeout?: number;
    connTimeout?: number;
  }

  class Imap {
    constructor(config: ImapConfig);
    once(event: string, callback: (...args: any[]) => void): void;
    on(event: string, callback: (...args: any[]) => void): void;
    connect(): void;
    end(): void;
    openBox(boxName: string, readOnly: boolean, callback: (err: Error | null, box: any) => void): void;
    search(criteria: any[], callback: (err: Error | null, uids: number[]) => void): void;
    fetch(uids: number[], options: any): any;
    addFlags(uids: number[], flags: string[], callback: (err: Error | null) => void): void;
    move(uids: number[], boxName: string, callback: (err: Error | null) => void): void;
  }

  export = Imap;
}
