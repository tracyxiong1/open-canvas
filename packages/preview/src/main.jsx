import React from "react";
import { createProject } from "@open-canvas/core/browser";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { localAssetUrl, localProjectUrl } from "./local-project-bridge.js";
import "@xyflow/react/dist/style.css";
import "./styles.css";

const query = new URLSearchParams(window.location.search);

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App
      initialDocument={createProject({ title: "新建画布" })}
      projectUrl={localProjectUrl(query.get("project-url"))}
      assetUrl={localAssetUrl(query.get("asset-url"))}
      initialDraftId={query.get("draft")}
    />
  </React.StrictMode>,
);
