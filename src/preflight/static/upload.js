/* Preflight Stage 1 — byte-exact CSV upload for the Command Center.
 * Sends the file as an ArrayBuffer (never read as text) so the server's SHA-256
 * covers the original bytes, including any BOM and CRLF line endings.
 * DOM output uses textContent / createElement only; no HTML strings are parsed.
 */
(function () {
  "use strict";

  var MAX_BYTES = 1048576;

  var form = document.getElementById("import-form");
  var input = document.getElementById("csv-file");
  var button = document.getElementById("import-button");
  var statusEl = document.getElementById("import-status");
  var errorsEl = document.getElementById("import-errors");
  if (!form || !input || !button || !statusEl || !errorsEl) {
    return;
  }

  function csrfToken() {
    var meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute("content") || "" : "";
  }

  function setStatus(message, busy) {
    statusEl.textContent = message;
    statusEl.classList.toggle("import-status--busy", !!busy);
  }

  function clearErrors() {
    while (errorsEl.firstChild) {
      errorsEl.removeChild(errorsEl.firstChild);
    }
    errorsEl.hidden = true;
    errorsEl.className = "import-errors";
    input.removeAttribute("aria-invalid");
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text !== undefined && text !== null) {
      node.textContent = String(text);
    }
    return node;
  }

  function showErrors(title, lines, issues, issueCount, sha256) {
    clearErrors();
    errorsEl.className = "import-errors callout callout--error";
    errorsEl.setAttribute("role", "alert");
    var heading = el("p", null, null);
    heading.appendChild(el("strong", null, title));
    errorsEl.appendChild(heading);
    lines.forEach(function (line) {
      errorsEl.appendChild(el("p", null, line));
    });
    if (sha256) {
      var hashLine = el("p", "hint", "File SHA-256: ");
      hashLine.appendChild(el("code", "hash", sha256));
      errorsEl.appendChild(hashLine);
    }
    if (issues && issues.length) {
      var list = el("ul", "issue-list", null);
      list.setAttribute("aria-label", "Validation issues");
      issues.forEach(function (issue) {
        var item = el("li", "issue", null);
        var where = el("div", "issue__where", null);
        where.appendChild(el("span", "issue__code", issue && issue.code ? issue.code : "ISSUE"));
        where.appendChild(
          el("span", null, issue && issue.row !== null && issue.row !== undefined ? "Row " + issue.row : "File")
        );
        if (issue && issue.field) {
          where.appendChild(el("span", null, "Field: " + issue.field));
        }
        item.appendChild(where);
        item.appendChild(el("div", null, issue && issue.message ? issue.message : ""));
        list.appendChild(item);
      });
      errorsEl.appendChild(list);
    }
    var total = typeof issueCount === "number" ? issueCount : issues ? issues.length : 0;
    var shown = issues ? issues.length : 0;
    if (total > shown) {
      errorsEl.appendChild(el("p", "hint", (total - shown) + " more issue(s) not listed."));
    }
    errorsEl.hidden = false;
    input.setAttribute("aria-invalid", "true");
    errorsEl.focus();
  }

  function readBuffer(file) {
    if (typeof file.arrayBuffer === "function") {
      return file.arrayBuffer();
    }
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsArrayBuffer(file);
    });
  }

  function safeBatchUrl(url) {
    return typeof url === "string" && url.indexOf("/batches/") === 0 && url.indexOf("//") === -1 ? url : null;
  }

  function finish() {
    button.disabled = false;
    button.removeAttribute("aria-disabled");
    form.removeAttribute("aria-busy");
  }

  // The server sends {"ok": false, ...} only before any commit, so only that
  // shape justifies telling the user the file was definitely rejected.
  function isDefinitiveRejection(data) {
    return data !== null && typeof data === "object" && !Array.isArray(data) && data.ok === false;
  }

  var UNCERTAIN_TEXT =
    "The import outcome is uncertain. Reload the Command Center to check whether a batch for this " +
    "file now exists. Re-importing the identical file is safe: it returns the same batch and keeps " +
    "existing decisions.";

  function showUncertain(status) {
    var lines = [UNCERTAIN_TEXT];
    if (typeof status === "number" && status > 0) {
      lines.push("The local server responded with HTTP " + status + " but no readable result.");
    } else {
      lines.push("No response was received from the local server (network error or the server stopped).");
    }
    showErrors("Import outcome uncertain.", lines, [], 0, null);
    errorsEl.className = "import-errors callout callout--warn";
    input.removeAttribute("aria-invalid");
  }

  function fallbackMessage(status) {
    if (status === 403) {
      return "The request was refused by the local server's security check. Reload the page and try again.";
    }
    if (status === 413) {
      return "The file is larger than 1 MiB.";
    }
    if (status === 411) {
      return "The upload had no length. Try again.";
    }
    return "The server reported a problem (HTTP " + status + ").";
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    clearErrors();
    var file = input.files && input.files[0];
    if (!file) {
      setStatus("", false);
      showErrors("Choose a CSV file first.", ["No file was selected, so nothing was imported."], [], 0, null);
      input.focus();
      return;
    }
    if (file.size > MAX_BYTES) {
      setStatus("", false);
      showErrors(
        "File too large — nothing was imported.",
        ["“" + file.name + "” is " + file.size + " bytes; the limit is " + MAX_BYTES + " bytes (1 MiB)."],
        [],
        0,
        null
      );
      return;
    }

    button.disabled = true;
    button.setAttribute("aria-disabled", "true");
    form.setAttribute("aria-busy", "true");
    setStatus("Uploading “" + file.name + "” and running checks", true);

    // Step 1: read the local file. A failure here (e.g. the file was moved or
    // deleted after it was picked) happens before any request is sent.
    Promise.resolve()
      .then(function () { return readBuffer(file); })
      .then(function (buffer) { upload(buffer, file); }, function () {
        finish();
        setStatus("", false);
        showErrors(
          "Could not read the selected file.",
          [READ_FAILED_TEXT],
          [],
          0,
          null
        );
      });
  });

  var READ_FAILED_TEXT =
    "The selected file could not be read by the browser, so nothing was sent or imported. " +
    "Choose the file again.";

  // Step 2: send the bytes. Only failures from here on can leave the outcome uncertain.
  function upload(buffer, file) {
    Promise.resolve()
      .then(function () {
        return fetch("/import", {
          method: "POST",
          body: buffer,
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/octet-stream",
            "X-CSRF-Token": csrfToken(),
            "X-Filename": encodeURIComponent(file.name)
          }
        });
      })
      .then(function (response) {
        return response
          .json()
          .catch(function () { return null; })
          .then(function (data) { return { status: response.status, data: data }; });
      })
      .then(function (result) {
        var data = result.data;
        if (data && data.ok === true) {
          var url = safeBatchUrl(data.url);
          var summary = (data.existing
            ? "This exact file was already imported; opening the existing batch"
            : "Imported " + data.row_count + " row(s) with " + data.finding_count + " finding(s); opening the batch");
          if (url) {
            setStatus(summary + "…", false);
            window.location.assign(url);
          } else {
            finish();
            setStatus("", false);
            showErrors("Unexpected server response.", ["The import may have succeeded but no valid batch link was returned. Reload the Command Center."], [], 0, null);
          }
          return;
        }
        finish();
        setStatus("", false);
        if (!isDefinitiveRejection(data)) {
          // Unparseable body, non-object JSON, or no boolean ok: the server may have
          // committed before failing, so never report a definite rejection.
          showUncertain(result.status);
          return;
        }
        var issues = Array.isArray(data.issues) ? data.issues : [];
        var count = typeof data.issue_count === "number" ? data.issue_count : issues.length;
        var lines = ["The whole file was rejected and nothing was imported. Fix the issues below and import again."];
        if (!issues.length) {
          lines.push(fallbackMessage(result.status));
        }
        showErrors(
          count ? "Import rejected: " + count + " issue(s) found." : "Import rejected.",
          lines,
          issues,
          count,
          typeof data.sha256 === "string" ? data.sha256 : null
        );
      })
      .catch(function () {
        // Network error or rejected fetch: the request may still have been committed.
        finish();
        setStatus("", false);
        showUncertain(null);
      });
  }

  // Re-enable the button if the page is restored from the back/forward cache.
  window.addEventListener("pageshow", function () {
    finish();
    setStatus("", false);
  });

  input.addEventListener("change", function () {
    clearErrors();
    setStatus("", false);
  });
})();
