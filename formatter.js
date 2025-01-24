const vscode = require("vscode");
const { spawnSync } = require("child_process");
const path = require("path");

async function installLuau() {
  const fs = require("fs");
  const https = require("https");
  const { execSync } = require("child_process");

  const isWindows = process.platform === "win32";
  const isMacOS = process.platform === "darwin";
  const binaryName = isWindows ? "luau.exe" : "luau";
  const luauPath = path.join(__dirname, binaryName);

  if (!fs.existsSync(luauPath)) {
    const progress = vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: "Installing Luau binary",
      cancellable: false
    }, async (progress) => {
      try {
        progress.report({ message: "Fetching latest Luau release..." });
        const options = {
          hostname: "api.github.com",
          path: "/repos/luau-lang/luau/releases/latest",
          headers: { "User-Agent": "Node.js" },
          followAllRedirects: true
        };

        await new Promise((resolve, reject) => {
          const request = https.get(options, (res) => {
            if (res.statusCode === 302 || res.statusCode === 301) {
              https.get(res.headers.location, handleResponse).on("error", reject);
              return;
            }
            handleResponse(res);
          });

          function handleResponse(res) {
            if (res.statusCode !== 200) {
              reject(new Error(`GitHub API request failed with status ${res.statusCode}`));
              return;
            }

            let data = "";
            res.on("data", (chunk) => data += chunk);
            res.on("end", async () => {
              try {
                const release = JSON.parse(data);
                const platformSuffix = isWindows ? "windows" : (isMacOS ? "macos" : "ubuntu");
                const asset = release.assets.find(a => a.name.includes(`luau-${platformSuffix}`));
                if (!asset) throw new Error(`Could not find ${platformSuffix} Luau binary`);

                progress.report({ message: "Downloading Luau binary..." });
                await new Promise((downloadResolve, downloadReject) => {
                  const downloadRequest = https.get(asset.browser_download_url, (downloadRes) => {
                    if (downloadRes.statusCode === 302 || downloadRes.statusCode === 301) {
                      https.get(downloadRes.headers.location, handleDownload).on("error", downloadReject);
                      return;
                    }
                    handleDownload(downloadRes);
                  });

                  function handleDownload(downloadRes) {
                    if (downloadRes.statusCode !== 200) {
                      downloadReject(new Error(`Failed to download Luau binary with status ${downloadRes.statusCode}`));
                      return;
                    }

                    const contentLength = parseInt(downloadRes.headers["content-length"], 10);
                    let downloadedLength = 0;

                    const zipPath = path.join(__dirname, "luau.zip");
                    const writeStream = fs.createWriteStream(zipPath);

                    downloadRes.on("data", (chunk) => {
                      downloadedLength += chunk.length;
                      if (contentLength) {
                        const percentage = Math.round((downloadedLength / contentLength) * 100);
                        progress.report({ message: `Downloading Luau binary... ${percentage}%` });
                      }
                    });

                    downloadRes.pipe(writeStream);

                    writeStream.on("finish", () => {
                      try {
                        if (contentLength && downloadedLength !== contentLength) {
                          fs.unlinkSync(zipPath);
                          downloadReject(new Error("Download size mismatch - file may be corrupted"));
                          return;
                        }

                        progress.report({ message: "Extracting Luau binary..." });
                        if (isWindows) {
                          execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${__dirname}' -Force"`);
                        } else {
                          const result = execSync(`unzip -t "${zipPath}"`);
                          if (!result.toString().includes("No errors")) {
                            throw new Error("Zip file integrity check failed");
                          }
                          execSync(`unzip -j "${zipPath}" -d "${__dirname}"`);
                          fs.chmodSync(luauPath, "755");
                        }
                        fs.unlinkSync(zipPath);
                        downloadResolve();
                      } catch (err) {
                        if (fs.existsSync(zipPath)) {
                          fs.unlinkSync(zipPath);
                        }
                        downloadReject(err);
                      }
                    });

                    writeStream.on("error", (err) => {
                      if (fs.existsSync(zipPath)) {
                        fs.unlinkSync(zipPath);
                      }
                      downloadReject(err);
                    });
                  }

                  downloadRequest.on("error", downloadReject);
                });
                resolve();
              } catch (err) {
                reject(err);
              }
            });
          }

          request.on("error", reject);
        });
      } catch (err) {
        vscode.window.showErrorMessage("Failed to download Luau: " + err.message);
        throw err;
      }
    });

    await progress;
  }
}

async function activate(context) {
  try {
    await installLuau();
  } catch (err) {
    vscode.window.showErrorMessage("Failed to initialize LUON formatter: " + err.message);
    return;
  }

  let disposable = vscode.commands.registerCommand('extension.formatLUON', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showInformationMessage('No editor is active');
      return;
    }

    const document = editor.document;
    if (document.languageId !== 'luon') {
      vscode.window.showInformationMessage('Not a LUON file');
      return;
    }

    const text = document.getText();
    const formatted = await formatLUON(text);

    editor.edit(editBuilder => {
      const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(text.length)
      );
      editBuilder.replace(fullRange, formatted);
    });
  });

  const formattingProvider = vscode.languages.registerDocumentFormattingEditProvider('luon', {
    async provideDocumentFormattingEdits(document) {
      const text = document.getText();
      const formatted = await formatLUON(text);
      const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(text.length)
      );
      return [vscode.TextEdit.replace(fullRange, formatted)];
    }
  });

  context.subscriptions.push(disposable, formattingProvider);
}

async function formatLUON(text) {
  const isWindows = process.platform === "win32";
  const binaryName = isWindows ? "luau.exe" : "luau";
  const luauPath = path.join(__dirname, binaryName);
  const scriptPath = path.join(__dirname, "format_luon.luau");

  const result = spawnSync(luauPath, [scriptPath, "-a", text], {
    stdio: ['pipe', 'pipe', 'pipe'],
    encoding: 'utf8'
  });

  if (result.error) {
    vscode.window.showErrorMessage("Error running LUON formatter: " + result.error.message);
    return text;
  }

  if (result.stderr && result.stderr.length > 0) {
    const errorMessage = result.stderr.toString().trim();
    vscode.window.showErrorMessage("Formatter error: " + errorMessage);
    return text;
  }

  return result.stdout ? result.stdout.toString().trim() : text;
}

function deactivate() { }

module.exports = {
  activate,
  deactivate,
};