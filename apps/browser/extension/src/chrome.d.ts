declare namespace chrome {
  namespace runtime {
    interface MessageSender {}
    const id: string;
    const onInstalled: {
      addListener(callback: () => void): void;
    };
    const onStartup: {
      addListener(callback: () => void): void;
    };
    const onMessage: {
      addListener(
        callback: (
          message: unknown,
          sender: MessageSender,
          sendResponse: (response?: unknown) => void,
        ) => boolean | void,
      ): void;
    };
    function sendMessage(message: unknown, responseCallback?: (response: unknown) => void): void;
  }

  namespace storage {
    const local: {
      get<T = Record<string, unknown>>(keys?: string[] | string | null): Promise<T>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string[] | string): Promise<void>;
      clear(): Promise<void>;
    };
  }

  namespace alarms {
    interface Alarm {
      name: string;
    }
    const onAlarm: {
      addListener(callback: (alarm: Alarm) => void): void;
    };
    function create(name: string, alarmInfo: { delayInMinutes?: number; periodInMinutes?: number }): Promise<void>;
  }

  namespace tabs {
    interface Tab {
      id?: number;
      windowId?: number;
      url?: string;
      title?: string;
      active?: boolean;
      status?: string;
    }
    const onUpdated: {
      addListener(callback: (tabId: number, changeInfo: { status?: string }, tab: Tab) => void): void;
      removeListener(callback: (tabId: number, changeInfo: { status?: string }, tab: Tab) => void): void;
    };
    function query(queryInfo: Record<string, unknown>): Promise<Tab[]>;
    function create(createProperties: { url?: string; active?: boolean }): Promise<Tab>;
    function update(tabId: number, updateProperties: { url?: string; active?: boolean }): Promise<Tab>;
    function get(tabId: number): Promise<Tab>;
    function captureVisibleTab(windowId?: number, options?: { format?: "png" | "jpeg"; quality?: number }): Promise<string>;
  }

  namespace scripting {
    interface InjectionResult<T = unknown> {
      frameId: number;
      result?: T;
    }
    function executeScript<T = unknown>(injection: {
      target: { tabId: number; allFrames?: boolean };
      func: (...args: any[]) => T | Promise<T>;
      args?: unknown[];
      world?: "ISOLATED" | "MAIN";
    }): Promise<Array<InjectionResult<T>>>;
  }

  namespace action {
    function setBadgeText(details: { text: string }): Promise<void>;
    function setBadgeBackgroundColor(details: { color: string }): Promise<void>;
  }
}
