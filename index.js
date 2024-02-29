const axios = require("axios");
const cheerio = require("cheerio");
const puppeteer = require("puppeteer");
const { main } = require("./db");
const { inspect } = require("node:util");
const fs = require("fs/promises");

const url = `https://source.android.com/docs/security/bulletin/2021-10-01`;
const rowData = [];
process.setMaxListeners(15);

async function scrapePage() {
  try {
    const collection = await main();
    const response = await axios.get(url);
    const content = response.data;
    const $ = cheerio.load(content);
    const table = $("table").eq(4);

    const headers = table.find("th").map((index, header) => $(header).text().trim()).get();

    table.find("tr").each((index, row) => {
      const cells = $(row).find("td");
      const rowObject = {};

      cells.each(async (i, cell) => {
        const columnName = headers[i];
        const cellText = $(cell).text().trim();

        if (i === 1) {
          const anchorTag = $(cell).find("a");
          if (anchorTag.length > 0) {
            const anchorUrl = anchorTag.attr("href");
            rowObject[columnName] = {
              text: cellText,
              link: anchorUrl,
            };
            await extendReferences(rowObject[columnName]);
            const dbData = await collection.insertOne(rowObject);
            // console.log(inspect(rowObject, true, null, true));
            return;
          }
        }

        rowObject[columnName] = cellText;
      });

      rowData.push(rowObject);
    });
  } catch (error) {
    console.error("Error:", error);
  }
}

async function extendReferences(references) {
  try {
    const browser = await puppeteer.launch({ headless: "new" });
    const page = await browser.newPage();
    await page.goto(references.link);
    await page.waitForSelector("table");

    const hrefSelector = "table:first-of-type tr:last-child span a";
    const hrefAttribute = await page.evaluate((selector) => {
      const anchor = document.querySelector(selector);
      return anchor ? anchor.getAttribute("href") : null;
    }, hrefSelector);

    if (hrefAttribute) {
      await page.goto("https://android.googlesource.com" + hrefAttribute);
      console.log("Navigated to:", hrefAttribute);
      await page.waitForSelector("table");
      const rows = await page.$$("table tr");

      const metadata = {};
      for (const row of rows) {
        const cells = await row.$$("td, th");
        if (cells.length >= 2) {
          const key = await cells[0].evaluate((element) => element.textContent.trim());
          const value = await cells[1].evaluate((element) => element.textContent.trim());
          metadata[key] = value;
        }
      }
      references.metaData = metadata;

      const metaDataMessage = await page.$(".u-pre.u-monospace.MetadataMessage");
      if (metaDataMessage) {
        const data = await metaDataMessage.evaluate((element) => element.textContent.trim());
        references.metadataMessage = data;
      }

      const diffElementsSelector = ".u-pre.u-monospace.Diff, .u-pre.u-monospace.Diff-unified";
      await page.waitForSelector(diffElementsSelector);

      const diffPairs = await page.evaluate(async (selector) => {
        const diffElements = Array.from(document.querySelectorAll(selector));
        const pairs = [];
        let currentPair = {};

        for (const diffElement of diffElements) {
          const diffText = diffElement.textContent.trim();

          if (diffElement.classList.contains("Diff")) {
            currentPair.diff = {};
            currentPair.diff.description = diffText;
            const anchorTags = diffElement.querySelectorAll("a");
            currentPair.diff.files = [];
            anchorTags.forEach((tag) => tag.getAttribute("href")
              ? currentPair.diff.files.push(tag.getAttribute("href"))
              : false
            );
          } else if (diffElement.classList.contains("Diff-unified")) {
            currentPair.diffUnified = diffText;
            pairs.push(currentPair);
            currentPair = {};
          }
        }
        return pairs;
      }, diffElementsSelector);

      diffPairs.forEach((pair) => {
        pair.diff.files.forEach((file, i) => {
          fetch("https://android.googlesource.com" + file)
            .then(async (data) => {
              const dir = `./public${file}`.split('/')
              dir.pop()
              await fs.mkdir(dir.join('/'), { recursive: true })
              const fileData = await data.text()
              fs.writeFile(`./public${file}`, fileData);
            })
            .catch((error) => console.log(error.message));
        });
      });

      references.changes = diffPairs;
    }

    await browser.close();
  } catch (error) {
    console.error("Error:", error);
  }
}

scrapePage();