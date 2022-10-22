import { App, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import defaultSettings, {
  DefaultSetting,
} from "samepage/utils/defaultSettings";
import setupSamePageClient from "samepage/protocols/setupSamePageClient";
import type { NotificationContainerProps } from "samepage/components/NotificationContainer";
import setupSharePageWithNotebook, {
  granularChanges,
} from "./protocols/sharePageWithNotebook";
import { onAppEvent } from "samepage/internal/registerAppEventListener";
import renderOverlay from "./utils/renderOverlay";

type Notifications = Awaited<
  ReturnType<Required<NotificationContainerProps>["api"]["getNotifications"]>
>;

const defaultTypeById = Object.fromEntries(
  defaultSettings.map((s) => [s.id, s.type])
);

const IGNORED_LOGS = new Set([
  "list-pages-success",
  "load-remote-message",
  "update-success",
]);

class SamePageSettingTab extends PluginSettingTab {
  plugin: SamePagePlugin;

  constructor(app: App, plugin: SamePagePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "SamePage Settings" });
    defaultSettings.forEach((s) => {
      const setting = new Setting(containerEl)
        .setName(s.name)
        .setDesc(s.description);
      if (s.type === "boolean") {
        setting.addToggle((toggle) => {
          const saved = this.plugin.data.settings[s.id];
          toggle
            .setValue(typeof saved !== "boolean" ? s.default : saved)
            .onChange((value) => {
              this.plugin.data.settings[s.id] = value;
              if (s.id === "granular-changes") {
                granularChanges.enabled = value;
              }
              this.plugin.save();
            });
        });
      } else if (s.type === "string") {
        setting.addText((text) => {
          const saved = this.plugin.data.settings[s.id];
          text
            .setValue(typeof saved !== "string" ? s.default : saved)
            .onChange((value) => {
              this.plugin.data.settings[s.id] = value;
              this.plugin.save();
            });
        });
      }
    });
  }
}

type Settings = {
  [k in DefaultSetting as k["id"]]?: k["type"] extends "boolean"
    ? boolean
    : k["type"] extends "string"
    ? string
    : never;
};

type PluginData = {
  settings: Settings;
  notifications: Record<string, Notifications[number]>;
};

type RawPluginData = {
  settings?: Settings;
  notifications?: Record<string, Notifications[number]>;
} | null;

class SamePagePlugin extends Plugin {
  data: PluginData = {
    settings: {},
    notifications: {},
  };

  async setupUserSettings() {
    const { settings = {}, notifications = {} } =
      ((await this.loadData()) as RawPluginData) || {};
    this.data = {
      settings: {
        ...Object.fromEntries(defaultSettings.map((s) => [s.id, s.default])),
        ...settings,
      },
      notifications,
    };

    const settingTab = new SamePageSettingTab(this.app, this);
    this.addSettingTab(settingTab);
  }

  setupClient() {
    const self = this;
    const checkCallback: Record<string, boolean> = {};
    const { unload } = setupSamePageClient({
      getSetting: (s) => this.data.settings[s] as string,
      setSetting: (s, v) => {
        // TODO - fix this typing
        if (defaultTypeById[s] === "string")
          this.data.settings[s as "uuid" | "token"] = v;
        if (defaultTypeById[s] === "boolean")
          this.data.settings[s as "granular-changes" | "auto-connect"] =
            v === "true";
        this.save();
      },
      addCommand: ({ label, callback }) => {
        if (label in checkCallback) checkCallback[label] = true;
        else {
          checkCallback[label] = true;
          self.addCommand({
            id: label.toLowerCase().replace(/ /g, "-"),
            name: label,
            checkCallback: (checking) => {
              if (checkCallback[label]) {
                if (!checking) {
                  callback();
                }
                return true;
              }
              return false;
            },
          });
        }
      },
      removeCommand: ({ label }) => {
        if (label in checkCallback) checkCallback[label] = false;
      },
      app: "Obsidian",
      workspace: this.app.vault.getName(),
      renderOverlay,
      onAppLog: (evt) => evt.intent !== "debug" && new Notice(evt.content),
    });
    return unload;
  }

  setupProtocols() {
    return setupSharePageWithNotebook(this);
  }

  async onload() {
    await this.setupUserSettings();
    const unloadSamePageClient = this.setupClient();
    const unloadProtocols = this.setupProtocols();
    this.onunload = () => {
      unloadProtocols();
      unloadSamePageClient();
    };
  }
  async save() {
    this.saveData(this.data);
  }
}

export default SamePagePlugin;
