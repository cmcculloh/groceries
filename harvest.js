import { chromium } from 'playwright'; // Import Playwright's chromium package
import urls from './products.js';
import fs from 'fs/promises';
import { SingleBar, Presets } from 'cli-progress';

// Initialize the progress bar
const progressBar = new SingleBar({
    format: 'Scraping Progress |{bar}| {percentage}% || {value}/{total} URLs',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true
}, Presets.shades_classic);


async function scrapeProduct(url, cookies) {
    const browser = await chromium.launch({ headless: false });

    try {
        const context = await browser.newContext();
        await context.addCookies(cookies);
        const page = await context.newPage();
        await page.goto(url, { waitUntil: 'load', timeout: 60000 });

        let price = null;
        let priceElement = await page.$('.ProductDetails-rowContainer .kds-Price-promotional');

        if (priceElement) {
            price = await priceElement.innerText();
        } else {

            priceElement = await page.$('.ProductDetails-rowContainer .kds-Price');
            if (priceElement) {
                price = await priceElement.innerText();
            }
        }

        if (!price) {
            // console.log(`No price found for URL: ${url}`);
            return null; // Or handle this scenario as needed
        }

        const name = await page.$eval('.ProductDetails-header', el => el.innerText);

        // PurchaseOptions--header-text
        const sellByUnit = await page.$('#ProductDetails-sellBy-unit');
        const sellByWeight = await page.$('#ProductDetails-sellBy-weight');
        let totalQty = 1;
        if (sellByUnit) {
            totalQty = await sellByUnit.innerText();
        } else if (sellByWeight) {
            totalQty = await sellByWeight.innerText();
        }

        let servingSize = totalQty || "";
        let { serving, unit } = { serving: 1, unit: 'ct'}
        let servincSizeElement = await page.$('.NutritionLabel-ServingSize');
        if (servincSizeElement) {
            servingSize = await servincSizeElement.innerText();
            servingSize = servingSize.replace(/Serving size\n/, '');
            const servingSizeMatch = servingSize.match(/(\d+\/\d+|\d*\.\d+|\d+)\s*([a-zA-Z]+)/);
            if (servingSizeMatch) {
                serving = servingSizeMatch[1];
                unit = servingSizeMatch[2];
            }
        }

        const servingsPerContainerElm = await page.$('.NutritionLabel-ServingsPerContainer');
        let servingsPerContainer = '';
        if (servingsPerContainerElm) {
            servingsPerContainer = await servingsPerContainerElm.innerText();
            servingsPerContainer = servingsPerContainer.replace(/(?: About )?Servings per container/i, '');
        }

        const imgElement = await page.$('.ProductImages-image');
        let img = null;
        if (!imgElement) {

            const imgElement = await page.$('.ImageLoader-image');
            if (!imgElement) {
                console.log(`No image found for URL: ${url}`);
                return null; // Or handle this scenario as needed
            } else {
                img = await imgElement.getAttribute('src');
            }
        }

        // kds-Breadcrumb
        const categories = await Promise.all(Array.from(await page.$$('.kds-Breadcrumb a')).slice(1).map(async (el) => { return await el.innerText() }));


        const upc = url.split('/').pop();
        const source = new URL(url).hostname.split('.')[1];

        return {
            [upc]: {
                link: url,
                name,
                source,
                price: price.replace(/\n/g, ''),
                totalQty,
                img,
                serving,
                unit,
                rawServingSize: servingSize,
                servingsPerContainer,
                categories
            }
        }

    } catch (error) {
        console.error(`Error in scrapeProduct for URL ${url}:`, error);
        return null;
    } finally {
        await browser.close(); // Ensure browser is always closed
    }
}


// Function to load existing data from list.js
async function loadExistingData() {
    try {
        const data = await import('./list.js');
        return data.default;
    } catch (error) {
        console.error('Error loading existing data:', error);
        return {};
    }
}

// Function to save data to list.js
async function saveData(data) {
    const content = `export default ${JSON.stringify(data, null, "\t")};`;
    await fs.writeFile('list.js', content);
}

// Function to save data to list.js
async function saveURLs(urls) {
    const content = `export default ${JSON.stringify(urls, null, "\t")};`;
    await fs.writeFile('products.js', content);
}

function delay(time) {
    return new Promise(function(resolve) {
        setTimeout(resolve, time);
    });
}

async function loadCookies() {
    const cookiesString = await fs.readFile('./cookies.json', 'utf8');
    const cookies = JSON.parse(cookiesString);

    // Adjust 'sameSite' values for each cookie
    cookies.forEach(cookie => {
        if (cookie.sameSite === 'no_restriction' || cookie.sameSite === 'unspecified') {
            cookie.sameSite = 'None';
        } else if (cookie.sameSite === 'lax') {
            cookie.sameSite = 'Lax';
        } else if (cookie.sameSite === 'strict') {
            cookie.sameSite = 'Strict';
        }
    });

    return cookies;
}

const quickMode = false;
const failures = [];

// Main scraping function
(async () => {
    const cookies = await loadCookies();

    if (!cookies) throw new Error('Cookies not found');
    const existingData = await loadExistingData();
    const results = { ...existingData }; // Clone existing data

    // make sure each url in urls is unique
    const uniqueURLs = [...new Set(urls)];

    progressBar.start(uniqueURLs.length, 0); // Start the progress bar

    let i = 0;
    for (let url of uniqueURLs) {
        const upc = url.split('/').pop();

        if (quickMode || results[upc] && results[upc].categories) {
            // console.log(`QuickMode: Skipping already existing product with UPC: ${upc}`);
        } else {
            // console.log(url);
            const data = await scrapeProduct(url, cookies);
            // console.log(data);
            // console.log('');
            if (data) {
                if (data) {
                    const upc = Object.keys(data)[0]; // Assuming UPC is the key of the product object
                    if (results[upc]) {
                        // If the product already exists, update only the price
                        results[upc].price = data[upc].price;
                        // add the categories
                        results[upc].categories = data[upc].categories;
                    } else {
                        // If the product is new, add it to the results
                        results[upc] = data[upc];
                    }
                }
            } else {
                failures.push(url);
            }
        }

        i++;
        // Update the progress bar
        progressBar.update(i);

        await saveData(results); // Save the merged data to list.js
        // Random delay between 3 to 5 seconds
        // const randomDelay = 3000 + Math.random() * 2000;
        // await delay(randomDelay);
    }

    progressBar.stop(); // Stop the progress bar



    await saveURLs(uniqueURLs)

    console.log('All done!')
    console.log('Failures:', failures);
})();
