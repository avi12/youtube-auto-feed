// Evaluated on chrome://extensions, whose private API is the only way to reload an unpacked
// extension from outside it
globalThis.reloadExtension = async function (name) {
  function call({ api, method, parameters }) {
    return new Promise((resolve, reject) => {
      chrome[api][method](...parameters, result => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve(result);
      });
    });
  }

  await call({
    api: "developerPrivate",
    method: "updateProfileConfiguration",
    parameters: [{ inDeveloperMode: true }]
  });
  const extensions = await call({
    api: "developerPrivate",
    method: "getExtensionsInfo",
    parameters: [{ includeDisabled: true }]
  });
  const extension = extensions.find(candidate => candidate.name === name);
  if (!extension) {
    throw new Error(
      `${name} is not installed - load the build once with "Load unpacked" on the extensions page; the dev profile keeps it`
    );
  }

  await call({
    api: "developerPrivate",
    method: "reload",
    parameters: [extension.id, { failQuietly: false }]
  });

  if (extension.state === "DISABLED") {
    await call({
      api: "management",
      method: "setEnabled",
      parameters: [extension.id, true]
    });
  }
};
