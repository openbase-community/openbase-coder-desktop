import { createRoot } from "react-dom/client";
import App from "@openbase/coder-react/App";
import { AppearanceProvider } from "@openbase/coder-react/appearance";
import { PluginRegistryProvider } from "@openbase/coder-react/plugin-registry";
import {
  configureProductAnalytics,
  configureProductAnalyticsPreference,
} from "@openbase/coder-react/product-analytics";
import { installWindowActivityAttribute } from "@openbase/coder-react/window-activity";
import "@openbase/coder-react/index.css";
import DesktopShell from "./DesktopShell";
import {
  isProductAnalyticsEnabled,
  productAnalytics,
  setProductAnalyticsEnabled,
} from "./analytics";
import runtimeDefaults from "../electron/runtime-defaults.json";

window.__OPENBASE_RUNTIME_CONFIG__ ??= {
  backendBaseUrl: runtimeDefaults.backendBaseUrl,
  shell: "electron",
};

document.documentElement.dataset.openbaseRuntime = "electron";
// Pause CSS animations while the window is unfocused or hidden.
installWindowActivityAttribute();
configureProductAnalytics(productAnalytics);
configureProductAnalyticsPreference({
  isEnabled: isProductAnalyticsEnabled,
  setEnabled: setProductAnalyticsEnabled,
});

createRoot(document.getElementById("root")!).render(
  <AppearanceProvider>
    <DesktopShell>
      <PluginRegistryProvider>
        <App />
      </PluginRegistryProvider>
    </DesktopShell>
  </AppearanceProvider>
);
