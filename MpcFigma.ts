import { chromium } from "playwright";
import sharp from "sharp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PNG } from "pngjs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { writeFile } from "fs/promises";
import path from "path";
import os from "os";
import pixelmatch from "pixelmatch";

const server = new McpServer({
  name: "Image Comparison MCP",
  version: "1.0",
});

server.tool(
  "compare-images",
  "tool-compare-images-urls",
  {
    url1: z.string().url().describe("URL of the local image"),
    url2: z.string().url().describe("URL of the deployed image"),
    width: z.number().optional().describe("Width of the screenshot"),
    height: z.number().optional().describe("Height of the screenshot"),
  },
  async ({ url1, url2, width, height }) => {
    const browser = await chromium.launch();
    const context = await browser.newContext();

    const screenshots: Record<string, Buffer> = {};

    const urls = [
      { name: "local", url: url1 },
      { name: "deployed", url: url2 },
    ];

    const viewportWidth = width || 1280;
    const viewportHeight = height || 720;

    for (const { name, url } of urls) {
      const page = await context.newPage();
      await page.setViewportSize({
        width: viewportWidth,
        height: viewportHeight,
      });
      await page.goto(url, { waitUntil: "networkidle" });
      await page.waitForTimeout(2000);
      const buffer = await page.screenshot({ fullPage: false });
      screenshots[name] = buffer;
      await page.close();
    }

    const finalBuffer = await createOverlayImageWithSharp(
      screenshots["local"],
      screenshots["deployed"],
      0.3
    );

    const img1 = PNG.sync.read(screenshots["local"]);
    const img2 = PNG.sync.read(screenshots["deployed"]);

    const { width: imgWidth, height: imgHeight } = img1;
    const diff = new PNG({ width: imgWidth, height: imgHeight });

    pixelmatch(img1.data, img2.data, diff.data, imgWidth, imgHeight, {
      threshold: 0.3,
    });

    const diffBuffer = PNG.sync.write(diff);

    const tempDir = os.tmpdir();

    const tempComparePath = path.join(tempDir, `mcp-compare.png`);
    const tempDiffPath = path.join(tempDir, `mcp-diff.png`);

    await writeFile(tempComparePath, finalBuffer);
    await writeFile(tempDiffPath, diffBuffer);

    await browser.close();

    return {
      content: [
        {
          type: "text",
          text: tempComparePath,
        },
        {
          type: "text",
          text: tempDiffPath,
        },
      ],
    };
  }
);

async function createOverlayImageWithSharp(
  baseBuffer: Buffer,
  overlayBuffer: Buffer,
  overlayOpacity: number
): Promise<Buffer> {
  const overlayWithOpacity = await sharp(overlayBuffer)
    .ensureAlpha()
    .composite([
      {
        input: Buffer.from([255, 255, 255, Math.round(255 * overlayOpacity)]),
        raw: {
          width: 1,
          height: 1,
          channels: 4,
        },
        tile: true,
        blend: "dest-in",
      },
    ])
    .toBuffer();

  const finalBuffer = await sharp(baseBuffer)
    .composite([{ input: overlayWithOpacity, blend: "over" }])
    .png()
    .toBuffer();

  return finalBuffer;
}

// Conexión MCP
const transport = new StdioServerTransport();
await server.connect(transport);
