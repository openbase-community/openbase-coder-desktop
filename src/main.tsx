import { createRoot } from "react-dom/client";
import App from "@openbase/coder-react/App";
import { PluginRegistryProvider } from "@openbase/coder-react/plugin-registry";
import "@openbase/coder-react/index.css";
import DesktopShell from "./DesktopShell";
import runtimeDefaults from "../electron/runtime-defaults.json";

window.__OPENBASE_RUNTIME_CONFIG__ ??= {
  backendBaseUrl: runtimeDefaults.backendBaseUrl,
  shell: "electron",
};

document.documentElement.dataset.openbaseRuntime = "electron";
document.documentElement.classList.remove("dark");

createRoot(document.getElementById("root")!).render(
  <DesktopShell>
    <PluginRegistryProvider>
      <App />
    </PluginRegistryProvider>
  </DesktopShell>
);
