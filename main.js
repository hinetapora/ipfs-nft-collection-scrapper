import config from "./config.js";
import puppeteer from "puppeteer";
import * as fs from "fs";
import * as path from "path";

const baseIpfsUrl = "https://ipfs.io/ipfs";
const {
  ipfsMetadataSampleUrl,
  collectionName,
  firstEditionId,
  lastEditionId,
  collectionSize,
  pageTimeout,
} = config;

let currentEdition = firstEditionId;
let metadataObject;
let errorCount = 0;
let currentEditionWithError = currentEdition;
let missingEditions = [];

async function getCollection() {
  const { browser, page } = await initPuppeteer();
  try {
    while (currentEdition <= lastEditionId) {
      page.setDefaultTimeout(pageTimeout);

      const metadataFileName = `${currentEdition}.json`;
      const metadataPath = generateFilePath(metadataFileName);
      const existsJsonFile = fs.existsSync(metadataPath);
      const metadataUrl = generateMetadataUrl();

      await getMetadataFromIpfs(page, metadataUrl);

      if (!existsJsonFile) {
        saveMetadataFile(metadataPath);
      }

      if (metadataObject) {
        const imageName = metadataObject.name;
        const imageFormat = metadataObject.image.split(".").pop();
        const imagePath = generateFilePath(`${imageName}.${imageFormat}`);
        const existsImageFile = fs.existsSync(imagePath);

        if (!existsImageFile) {
          const imageUrl = metadataObject.image;
          const ipfsImageUrl = generateIpfsImageUrl(imageUrl);
          const imageBuffer = await getImagesFromIpfs(page, ipfsImageUrl);
          saveImageFile(imagePath, imageBuffer);
        }
      }

      currentEdition++;
      const imagesCount = fs.readdirSync(`${collectionName}/images`).length;

      if (imagesCount === collectionSize) {
        await browser.close();
        return console.log("Collection completely fetched!");
      }

      if (currentEdition > lastEditionId) {
        console.log("Fetching missing files...");
        await getMissingFiles(browser, page);
      }
    }
  } catch (error) {
    await browser.close();
    const hasTooManyResquestsFailed = checkForError();
    if (hasTooManyResquestsFailed) {
      missingEditions.push(currentEdition);
      console.log(
        `Edition ${currentEdition} is taking too much time to load at IPFS, the script will get the rest of the collection and get back to missing ones later!`
      );
      currentEdition++;
    }
    setTimeout(() => {
      getCollection();
    }, 100);
  }
}

function createFolders() {
  if (!fs.existsSync(collectionName)) {
    fs.mkdirSync(collectionName);
    fs.mkdirSync(`${collectionName}/metadata`);
    fs.mkdirSync(`${collectionName}/images`);
  }
}

async function initPuppeteer() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  const ua =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36";
  await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
  await page.setUserAgent(ua);

  return { browser, page };
}

function generateFilePath(fileName) {
  if (fileName.includes(".json")) {
    return path.resolve(collectionName, "metadata", fileName);
  }
  return path.resolve(collectionName, "images", fileName);
}

function generateMetadataUrl(missingEdition) {
  const hasFileExtension = ipfsMetadataSampleUrl.includes(".json");
  const barIndex = ipfsMetadataSampleUrl.lastIndexOf("/");
  const baseMetadataUrl = ipfsMetadataSampleUrl.slice(0, barIndex);
  const edition = missingEdition ?? currentEdition;

  if (hasFileExtension) {
    return `${baseMetadataUrl}/${edition}.json`;
  }

  return `${baseMetadataUrl}/${edition}`;
}

async function getMetadataFromIpfs(page, metadataUrl) {
  await page.goto(metadataUrl);
  await page.content();

  metadataObject = await page.evaluate(() => {
    return JSON.parse(document.querySelector("body").innerText);
  });
}

async function getImagesFromIpfs(page, ipfsImageUrl) {
  const response = await page.goto(`${ipfsImageUrl}`);
  const imageBuffer = await response.buffer();
  return imageBuffer;
}

function saveMetadataFile(metadataPath, missingEdition) {
  fs.writeFileSync(metadataPath, JSON.stringify(metadataObject, null, 2));
  const edition = missingEdition ?? currentEdition;

  console.log(
    `${collectionName} #${edition} metadata saved to ${metadataPath}`
  );
}

function saveImageFile(imagePath, imageBuffer, missingEdition) {
  const writeStream = fs.createWriteStream(imagePath);
  const edition = missingEdition ?? currentEdition;
  writeStream.write(imageBuffer);

  console.log(`${collectionName} #${edition} image saved to ${imagePath}`);
}

const generateIpfsImageUrl = (imageUrl) => {
  const imageUrlSplited = imageUrl.split("/");
  const imageCID = imageUrlSplited[2];

  let imageFormat;

  if (imageUrlSplited[3]) {
    imageFormat = imageUrlSplited[3].split(".")[1];
  }

  let ipfsImageUrl;

  if (imageFormat) {
    ipfsImageUrl = `${baseIpfsUrl}/${imageCID}/${currentEdition}.${imageFormat}`;
  } else {
    ipfsImageUrl = `${baseIpfsUrl}/${imageCID}`;
  }

  return ipfsImageUrl;
};

function checkForError() {
  const maxErrorCount = 50;
  if (currentEdition === currentEditionWithError) {
    errorCount++;
    if (errorCount >= maxErrorCount) {
      return true;
    }
  }
  currentEditionWithError = currentEdition;
}

async function getMissingFiles(browser, page) {
  let editionIndex = 0;
  try {
    while (missingEditions.length !== 0) {
      const missingEdition = missingEditions[editionIndex];
      const metadataFileName = `${missingEdition}.json`;
      const metadataPath = generateFilePath(metadataFileName);
      const existsJsonFile = fs.existsSync(metadataPath);
      const metadataUrl = generateMetadataUrl(missingEdition);

      await getMetadataFromIpfs(page, metadataUrl);

      if (!existsJsonFile) {
        saveMetadataFile(metadataPath, missingEdition);
      }

      if (metadataObject) {
        const imageName = metadataObject.name;
        const imageFormat = metadataObject.image.split(".").pop();
        const imagePath = generateFilePath(`${imageName}.${imageFormat}`);
        const existsImageFile = fs.existsSync(imagePath);

        if (!existsImageFile) {
          const imageUrl = metadataObject.image;
          const ipfsImageUrl = generateIpfsImageUrl(imageUrl);
          const imageBuffer = await getImagesFromIpfs(page, ipfsImageUrl);
          saveImageFile(imagePath, imageBuffer, missingEdition);
        }
      }

      missingEditions = missingEditions.filter(
        (element, index) => index !== editionIndex
      );

      if (editionIndex > missingEditions.length + 1) {
        editionIndex = 0;
      }

      const imagesCount = fs.readdirSync(`${collectionName}/images`).length + 1;

      if (imagesCount === collectionSize) {
        await browser.close();
        return console.log("Collection completely fetched!");
      }
    }
  } catch (error) {
    const hasTooManyResquestsFailed = checkForError();
    if (hasTooManyResquestsFailed) {
      console.log(
        `Edition ${editionIndex} is taking too much time to load at IPFS, the script will get the rest of the collection and get back to missing ones later!`
      );
      editionIndex++;
    }
    setTimeout(() => {
      getMissingFiles(browser, page);
    }, 100);
  }
}

createFolders();
console.log("Fetching files...");
getCollection();
