declare module "web-ext-run" {
  interface RunOptions {
    target: "firefox-desktop" | "chromium";
    sourceDir: string;
    startUrl?: string[];
    keepProfileChanges?: boolean;
    firefoxProfile?: string;
    chromiumProfile?: string;
    args?: string[];
    noReload?: boolean;
    noInput?: boolean;
  }

  interface FirefoxRdpClient {
    request(request: string | {
      to: string;
      type: string;
      options?: unknown;
    }): Promise<{
      tabs?: Array<{
        actor: string;
        url?: string;
      }>;
      frame?: { actor?: string };
    }>;
  }

  interface FirefoxExtensionRunner {
    remoteFirefox?: { client: FirefoxRdpClient };
  }

  interface RunResult {
    reloadAllExtensions(): Promise<void>;
    exit(): Promise<void>;
    extensionRunners?: FirefoxExtensionRunner[];
  }

  const webExt: {
    cmd: {
      run(options: RunOptions, meta: { shouldExitProgram: boolean }): Promise<RunResult>;
    };
  };

  export default webExt;
}

declare module "web-ext-run/util/logger" {
  interface LogEntry {
    level: number;
    msg: string;
    name: string;
  }

  export const consoleStream: {
    write: (entry: LogEntry) => void;
  };
}
