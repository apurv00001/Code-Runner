import express, { type Express } from "express";
import cors from "cors";
import router from "./routes";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app: Express = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

if (process.env.NODE_ENV === "production") {
  const candidates = [
    path.resolve(__dirname, "public"),
    path.resolve(__dirname, "../public"),
    path.resolve(process.cwd(), "artifacts/web-code-editor/dist/public"),
  ];
  const distPath = candidates.find((p) => existsSync(p));
  if (distPath) {
    app.use(express.static(distPath));
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }
}

export default app;
