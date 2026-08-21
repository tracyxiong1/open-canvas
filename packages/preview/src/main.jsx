import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { localAssetUrl, localProjectUrl } from "./local-project-bridge.js";
import "@xyflow/react/dist/style.css";
import "./styles.css";

const query = new URLSearchParams(window.location.search);

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App
      projectUrl={localProjectUrl(query.get("project-url"))}
      assetUrl={localAssetUrl(query.get("asset-url"))}
      initialDraftId={query.get("draft")}
    />
  </React.StrictMode>,
);
