import {extname, join} from 'node:path';
import {mkdir, stat} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {argv} from 'node:process';
import {promisify} from 'node:util';
import stream from 'node:stream';

import {Parser} from 'htmlparser2';
import {setWallpaper} from 'wallpaper';
import {sizeFormatter, durationFormatter} from 'human-readable';

import got from 'got';

const DEBUG = false;
const pipeline = promisify(stream.pipeline);

const apodUrl = 'https://apod.nasa.gov/apod/';
const apodToday = 'astropix.html';

const apod = got.extend({
	prefixUrl: apodUrl,
	responseType: 'text',
	resolveBodyOnly: true,
});

const formatBytes = sizeFormatter({
	std: 'JEDEC',
	decimalPlaces: 2,
	keepTrailingZeroes: false,
	render: (literal, symbol) => `${literal} ${symbol}B`,
});
const formatDuration = durationFormatter({
	allowMultiples: ['m', 's', 'ms'],
	keepNonLeadingZeroes: false,
});

async function main(mode) {
	let date;
	let imagePath;
	const modeAsNumber = Number.parseInt(mode, 10);
	if (mode === 'random' || mode === 'r') {
		({imagePath, date} = await getRandomApodImagePathAndDate());
	} else if (mode === 'yesterday' || mode === 'y') {
		console.info('Looking for yesterday\'s image ...');
		date = getDateDaysAgo(1);
		imagePath = await getImagePathForDate(date);
	} else if (Number.isInteger(modeAsNumber)) {
		console.info(`Looking for image from ${modeAsNumber} days ago ...`);
		date = getDateDaysAgo(modeAsNumber);
		imagePath = await getImagePathForDate(date);
	} else {
		console.info('Looking for today\'s image ...');
		imagePath = await getImagePathFromPage(apodToday);
	}

	if (isImagePath(imagePath)) {
		const imageFile = await saveImage(imagePath, date);
		await setImageAsWallpaper(imageFile);
		console.info('Done');
	} else {
		console.info('No image found.');
	}
}

async function getRandomApodImagePathAndDate() {
	let randomDate;
	let imagePath;
	do {
		randomDate = getRandomApodDate();
		imagePath = await getImagePathForDate(randomDate); /* eslint-disable-line no-await-in-loop */
	} while (!isImagePath(imagePath));

	return {imagePath, date: randomDate};
}

async function getImagePathFromPage(path) {
	console.info(`Getting ${apodUrl}${path} ...`);
	const html = await apod.get(path);
	return findImagePath(html);
}

async function getImagePathForDate(date) {
	const pagePath = getPageNameForDate(date);
	return getImagePathFromPage(pagePath);
}

function getDateDaysAgo(days) {
	const date = new Date();
	date.setUTCDate(date.getUTCDate() - days);
	return date;
}

function isImagePath(somePath) {
	if (somePath) {
		const format = extname(somePath);
		return ['.jpg', '.gif', '.png'].includes(format);
	}

	return false;
}

function getRandomApodDate() {
	// Adapted from script in https://apod.nasa.gov/apod/random_apod.html

	/// //////////////////////////////////////////////////
	// Random APOD Date Generator                      //
	// by Geckzilla aka Judy Schmidt www.geckzilla.com //
	// Copy it, share it, modify it--I don't mind.     //
	/// //////////////////////////////////////////////////

	const now = new Date(); // Right now
	const min = new Date(1995, 5, 16).getTime(); // 1995 June 16 00:00:00, the first APOD
	let max = new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 18, 59, 59, 999).getTime(); // Now converted UTC time at 03:59:59.999

	// taking off 6 hours because APOD goes by east coast USA time.
	// should be enough to keep anyone from landing on future APODs which won't be published yet in their timezone
	// unless their computer clock is set way off, then they'll get 404's all the time probably
	max -= (5 * 60 * 60 * 1000);

	let randomTime = Math.round(min + (Math.random() * (max - min))); // Ahh, a random APOD date!

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

	// Convert the timestamp back into a date object
	return new Date(randomTime);
}

function getPageNameForDate(date) {
	// In the year 2095 we're gonna have problems
	const year = date.getFullYear().toString().slice(-2);
	const month = (date.getMonth() + 1).toString().padStart(2, '0');
	const day = date.getDate().toString().padStart(2, '0');
	return `ap${year}${month}${day}.html`;
}

function findImagePath(html) {
	return new Promise(resolve => {
		let aCount = 0;
		let imagePath;
		const parser = new Parser(
			{
				onopentag(name, attribs) {
					if (name === 'a') {
						aCount++;
						if (aCount === 2) {
							imagePath = attribs.href;
						}
					}
				},
				onend() {
					resolve(imagePath);
				},
			},
			{decodeEntities: true},
		);
		parser.write(html);
		parser.end();
	});
}

async function saveImage(imagePath, dateForName = new Date()) {
	const format = extname(imagePath);
	const imageDir = 'download';
	const today = dateForName.toISOString().slice(0, 10);
	const imageFile = join(imageDir, `apod-${today}${format}`);
	await mkdir(imageDir, {recursive: true});
	await downloadImageFile(imagePath, imageFile);
	return imageFile;
}

async function downloadImageFile(imagePath, imageFile) {
	console.info(`Writing ${imagePath} to ${imageFile} ...`);
	const time = Date.now();
	const downloadStream = apod.stream(imagePath);
	if (DEBUG) {
		downloadStream.on('downloadProgress', progress => {
			console.log(progress);
		});
	}

	await pipeline(downloadStream, createWriteStream(imageFile));
	const duration = Date.now() - time;
	const imageFileStat = await stat(imageFile);
	console.info(`Downloaded ${formatBytes(imageFileStat.size)} in ${formatDuration(duration)}.`);
}

async function setImageAsWallpaper(imageFile) {
	console.info(`Setting ${imageFile} as wallpaper ...`);
	return setWallpaper(imageFile);
}

try {
	await main(argv[2]);
} catch (error) {
	console.error(error);
}
