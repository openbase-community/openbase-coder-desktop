const assert = require("node:assert/strict");
const test = require("node:test");

const { isDeveloperDashboardOnly } = require("./developer-dashboard.cjs");

test("every unpackaged Electron launch is dashboard-only", () => {
  assert.equal(isDeveloperDashboardOnly({ appPackaged: false, envValue: "1" }), true);
  assert.equal(isDeveloperDashboardOnly({ appPackaged: false, envValue: undefined }), true);
  assert.equal(isDeveloperDashboardOnly({ appPackaged: true, envValue: "1" }), false);
});

test("a development installation always disables Electron setup", () => {
  const installation = { standalone: false, workspace_path: "/workspace" };

  assert.equal(
    isDeveloperDashboardOnly({ appPackaged: false, envValue: undefined, installation }),
    true,
  );
  assert.equal(
    isDeveloperDashboardOnly({ appPackaged: true, envValue: undefined, installation }),
    true,
  );
});

test("a standalone installation keeps production onboarding enabled", () => {
  assert.equal(
    isDeveloperDashboardOnly({
      appPackaged: true,
      envValue: undefined,
      installation: { standalone: true },
    }),
    false,
  );
});
