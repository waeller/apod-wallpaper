
const path = require('path');
const { mkdir, writeFile } = require('fs').promises;
const { Parser } = require('htmlparser2');
const wallpaper = require('wallpaper');

const bent = require('bent');
const apodUrl = 'https://apod.nasa.gov/apod/';
const apodToday = 'astropix.html';
const getApodAsString = bent(apodUrl, 'GET', 'string', 200);
const getApodAsBuffer = bent(apodUrl, 'GET', 'buffer', 200);

const { sizeFormatter, durationFormatter } = require('human-readable');
const formatBytes = sizeFormatter({
  std: 'JEDEC',
  decimalPlaces: 2,
  keepTrailingZeroes: false,
  render: (literal, symbol) => `${literal} ${symbol}B`
});
const formatDuration = durationFormatter({
  allowMultiples: ['m', 's', 'ms'],
  keepNonLeadingZeroes: false
});

async function main (mode) {
  let date;
  let imagePath;
  if (mode === 'random' || mode === 'r') {
    ({ imagePath, date } = await getRandomApodImagePathAndDate());
  } else if (mode === 'yesterday' || mode === 'y') {
    console.info('Looking for yesterday\'s image ...');
    date = getDateDaysAgo(1);
    imagePath = await getImagePathForDate(date);
  } else {
    console.info('Looking for today\'s image ...');
    imagePath = await getImagePathFromPage(apodToday);
  }
  if (isImagePath(imagePath)) {
    const imageFile = await saveImage(imagePath, date);
    await setWallpaper(imageFile);
    console.info('Done');
  } else {
    console.info('No image found.');
  }
}

async function getRandomApodImagePathAndDate () {
  let randomDate;
  let imagePath;
  do {
    randomDate = getRandomApodDate();
    imagePath = await getImagePathForDate(randomDate);
  } while (!isImagePath(imagePath));
  return { imagePath, date: randomDate };
}

async function getImagePathFromPage (path) {
  console.info(`Getting ${apodUrl}${path} ...`);
  const html = await getApodAsString(path);
  return findImagePath(html);
}

async function getImagePathForDate (date) {
  const pagePath = getPageNameForDate(date);
  return await getImagePathFromPage(pagePath);
}

function getDateDaysAgo (days) {
  return new Date(Date.now() - days * 24 * 3600 * 1000);
}

function isImagePath (somePath) {
  if (somePath) {
    const format = path.extname(somePath);
    return ['.jpg', '.gif', '.png'].includes(format);
  }
  return false;
}

function getRandomApodDate () {
  // adapted from script in https://apod.nasa.gov/apod/random_apod.html

  /// //////////////////////////////////////////////////
  // Random APOD Date Generator                      //
  // by Geckzilla aka Judy Schmidt www.geckzilla.com //
  // Copy it, share it, modify it--I don't mind.     //
  /// //////////////////////////////////////////////////

  const now = new Date(); // right now
  const min = new Date(1995, 5, 16).getTime(); // 1995 June 16 00:00:00, the first APOD
  let max = new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 18, 59, 59, 999).getTime(); // now converted UTC time at 03:59:59.999

  // taking off 6 hours because APOD goes by east coast USA time.
  // should be enough to keep anyone from landing on future APODs which won't be published yet in their timezone
  // unless their computer clock is set way off, then they'll get 404's all the time probably
  max = max - (5 * 60 * 60 * 1000);

  let randomTime = Math.round(min + (Math.random() * (max - min))); // ahh, a random APOD date!

  // but wait...
  // there's one section of missing APODs in the history of APODs
  // that's the first three days after the very first APOD was posted
  // June 17th, 18th, & 19th, 1995
  const missingMin = new Date(1995, 5, 17).getTime(); // 1995 June 17 00:00:00
  const missingMax = new Date(1995, 5, 19, 23, 59, 59, 999).getTime(); // 1995 June 19 23:59:59.999

  // if our random date falls in this range, remake it.
  while (randomTime >= missingMin && randomTime <= missingMax) {
    randomTime = Math.round(min + (Math.random() * (max - min)));
  }
  // convert the timestamp back into a date object
  return new Date(randomTime);
}

function getPageNameForDate (date) {
  // in the year 2095 we're gonna have problems
  const year = date.getFullYear().toString().slice(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `ap${year}${month}${day}.html`;
}

function findImagePath (html) {
  return new Promise((resolve, reject) => {
    let aCount = 0;
    let imagePath;
    const parser = new Parser(
      {
        onopentag: (name, attribs) => {
          if (name === 'a') {
            aCount++;
            if (aCount === 2) {
              imagePath = attribs.href;
            }
          }
        },
        onend: () => {
          resolve(imagePath);
        }
      },
      { decodeEntities: true }
    );
    parser.write(html);
    parser.end();
  });
}

async function saveImage (imagePath, dateForName = new Date()) {
  const format = path.extname(imagePath);
  const imageDir = 'download';
  const today = dateForName.toISOString().substring(0, 10);
  const imageFile = path.join(imageDir, `apod-${today}${format}`);
  console.info(`Writing ${imagePath} to ${imageFile} ...`);
  await mkdir(imageDir, { recursive: true });
  const time = Date.now();
  const imageContent = await getApodAsBuffer(imagePath);
  await writeFile(imageFile, imageContent);
  const duration = Date.now() - time;
  console.info(`Downloaded ${formatBytes(imageContent.length)} in ${formatDuration(duration)}.`);
  return imageFile;
}

async function setWallpaper (imageFile) {
  console.info(`Setting ${imageFile} as wallpaper ...`);
  return wallpaper.set(imageFile);
}

main(process.argv[2])
  .then()
  .catch(console.error);
