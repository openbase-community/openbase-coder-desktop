const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DownloadedUpdateHelper } = require("electron-updater/out/DownloadedUpdateHelper");

for (const truncated of [true, false]) {
  test(`persisted Electron download cache ${truncated ? "rejects partial" : "reuses complete"} archive`, async () => {
    const cache = await fs.mkdtemp(path.join(os.tmpdir(), "update-cache-test-"));
    try {
      const helper = new DownloadedUpdateHelper(cache);
      const body = Buffer.from("complete fixture archive bytes");
      const sha512 = createHash("sha512").update(body).digest("base64");
      const pending = helper.cacheDirForPendingUpdate;
      await fs.mkdir(pending);
      const archive = path.join(pending, "update.zip");
      await fs.writeFile(archive, truncated ? body.subarray(0, 10) : body);
      await fs.writeFile(path.join(pending, "update-info.json"), JSON.stringify({ fileName: "update.zip", sha512 }));
      const actual = await helper.getValidCachedUpdateFile({ info: { sha512 } }, { info() {}, warn() {} });
      assert.equal(actual, truncated ? null : archive);
      if (truncated) assert.deepEqual(await fs.readdir(pending), []);
    } finally {
      await fs.rm(cache, { recursive: true, force: true });
    }
  });
}
