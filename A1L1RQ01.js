const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const con = require('.');

async function a1l1q1(id,framework,outputPort, serverNumber = 1) { 

  // console.log("vanakam da mapla naan dhan output port test la irundhu", outputPort);
  // console.log("inside test"); 
  // Define base URL based on framework
  
  let baseURL = '';
//   baseURL="http://localhost:5173"
  // if (id=== '6' && framework === 'react') {
  //   baseURL = 'http://localhost:5177';
  // } else if (id=== '6' && framework === 'vue') {
  //   baseURL = 'http://localhost:5178';
  // } else if (id=== '9' && framework === 'react') {
  //   baseURL = 'http://localhost:5179';
  // } else if (id=== '9' && framework === 'vue') {
  //   baseURL = 'http://localhost:5180';
  // } else if (id=== '12' && framework === 'react') {
  //   baseURL = 'http://localhost:5185';
  // } else if (id=== '12' && framework === 'vue') {
  //   baseURL = 'http://localhost:5186';
  // } 

  if (outputPort) {
    baseURL = serverNumber > 1 || process.env.CONTAINER_ROUTING_MODE === 'production'
      ? `https://aws-test.starsquare.in/container-server/${serverNumber}/out/${outputPort}/`
      : `http://localhost:${outputPort}`;
  }

  console.log("This is the baseURL:", baseURL);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(baseURL);

  const viewportSizesToTest = [
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
    { width: 768, height: 1024 },
    { width: 425, height: 800 },
    { width: 375, height: 667 }
  ];
  
  const concurrentUsers = 2;
  
  // Performance test function
  async function performanceTest() {
    const loadTimes = await Promise.all(
      Array.from({ length: concurrentUsers }).map(async (_, i) => {
        const browser = await chromium.launch();
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.setViewportSize(viewportSizesToTest[i % viewportSizesToTest.length]);
        const start = Date.now();
        await page.goto(baseURL, { waitUntil: 'networkidle' });
        const end = Date.now();
        await browser.close();
        return end - start;
      })
    );
    
    const avgLoadTime = loadTimes.reduce((a, b) => a + b, 0) / loadTimes.length;
    let score = 10;
    
    return {
      name: 'Concurrent Load Time',
      selector: 'html',
      score,
      Loadtime: avgLoadTime,
      category: 'Performance - Page Load',
      averageLoadTime: avgLoadTime,
      loadTimes
    };
    
  }

  async function eventhandling() {
    const browser = await chromium.launch(); 
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(baseURL);
    // STEP 1: Click the "Add Personal Info" button
    await page.click('.profilebutton');
    // STEP 2: Wait for form to appear
    try {
      await page.waitForSelector('form#personalInfoForm', { timeout: 3000 });
      console.log('✅ Modal form appeared');
      return true
    } catch (err) {
      console.error('❌ Modal form did not appear in time.');
      await browser.close();
      return false;
    }
}

async function datahandling() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  

  await page.goto(baseURL);

  // STEP 1: Click the "Add Personal Info" button
  await page.click('.profilebutton');

  // STEP 2: Wait for form to appear
  try {
    await page.waitForSelector('form#personalInfoForm', { timeout: 3000 });
    console.log('✅ Modal form appeared');
  } catch (err) {
    console.error('❌ Modal form did not appear in time.');
    await browser.close();
    return false;
  }

  // STEP 3: Fill the form
  await page.fill('input[name="name"]', 'John Doe');
  await page.fill('input[name="email"]', 'john@example.com');
  await page.fill('input[name="phone"]', '9876543210');
  await page.fill('input[name="location"]', 'Chennai');

  // STEP 4: Upload image if file exists
  const imagePath = path.resolve(__dirname, 'test-image.jpg');
  if (fs.existsSync(imagePath)) {
    const imageInput = await page.$('input[name="image"]');
    await imageInput.setInputFiles(imagePath);
  }

  // STEP 5: Submit the form
  await page.click('button[type="submit"]');

  // STEP 6: Wait for profile content to update
  await page.waitForFunction(() => {
    const nameEl = document.querySelector('.name');
    return nameEl && nameEl.innerText === 'John Doe';
  });

  // STEP 7: Extract and verify data
  const name = await page.textContent('.name');
  const email = await page.textContent('.useremail');
  const phone = await page.textContent('.userphonenumber');
  const location = await page.textContent('.userLocation');

  console.log({ name, email, phone, location });

  if (
    name.trim() === 'John Doe' &&
    email.trim() === 'john@example.com' &&
    phone.trim() === '9876543210' &&
    location.trim() === 'Chennai'
  ) {
    console.log('✅ Personal info form is working correctly.');
    await browser.close();
    return true;
  } else {
    console.error('❌ Mismatch in displayed info.');
    await browser.close();
    return false;
  }
}
  // Responsiveness test function
  async function responsivenessTest() {
    const viewportResults = [];
    for (const viewport of viewportSizesToTest) {
      const browser = await chromium.launch();
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.setViewportSize(viewport);
      await page.goto(baseURL);
      const isResponsive = await page.evaluate(vp => window.innerWidth >= vp.width, viewport);
      await browser.close();
      viewportResults.push({ viewport, isResponsive });
    }
    
    const passed = viewportResults.filter(r => r.isResponsive).length;
    const total = viewportResults.length;
    const score = Math.round((passed / total) * 20);  // Score out of 20

    return {
      name: 'Viewport Responsiveness',
      selector: 'body',
      score,
      category: 'Responsiveness - Viewport Support',
      results: viewportResults
    };
  }

  // Check HTML structure function
  async function checkHtmlStructure(page) {
    console.log("Checking label structure...");
    const result = await page.evaluate(() => {
      const label = document.querySelector('label');
      if (!label) return { found: false };
      const labelText = label.textContent.trim();
      // Extract time (e.g., from "Wednesday 07 May 2025, 14:38:05")
      const timeMatch = labelText.match(/(\d{2}):(\d{2})(?::(\d{2}))?/);
      if (!timeMatch) {
        return { found: true, text: labelText, valid: false };
      }
      const labelHours = parseInt(timeMatch[1], 10);
      const labelMinutes = parseInt(timeMatch[2], 10);
      const now = new Date();
      const currentHours = now.getHours();
      const currentMinutes = now.getMinutes();
      const timeIsClose =
        labelHours === currentHours &&
        Math.abs(labelMinutes - currentMinutes) <= 1;
      return {
        found: true,
        text: labelText,
        valid: timeIsClose
      };
    });

    return result.found
   };

  // CSS property check function
  const expectedFound = [];

  async function checkCssProperty(page, selector, property, expectedValue) {
    const element = await page.$(selector);
    if (!element) {
      console.log(`❌ Element "${selector}" not found.`);
      return false;
    }
  
    const actualValue = await page.$eval(selector, (el, prop) =>
      getComputedStyle(el)[prop], property);
  
    let isMatch = false;
  
    if (property === 'transform') {
      const match = actualValue.match(/matrix\(([^)]+)\)/);
      if (match) {
        const matrixParts = match[1].split(',').map(x => parseFloat(x.trim()));
        const translateY = matrixParts[5];
        const expectedY = parseFloat(expectedValue.match(/-?\d+/)[0]);
        isMatch = Math.abs(translateY - expectedY) <= 0.5;
      }
    } else if (property === 'font-family' || property === 'fontFamily') {
      const normalizeFonts = (str) =>
        str
          .toLowerCase()
          .replace(/['"]/g, '')
          .split(',')
          .map(f => f.trim());
    
      const actualFonts = normalizeFonts(actualValue);
      const expectedFonts = normalizeFonts(expectedValue);
      const matchesStack = expectedFonts.every(font => actualFonts.includes(font));
      isMatch = matchesStack;
    
      console.log(`🎯 Expected font stack:`, expectedFonts);
      console.log(`🎯 Actual font stack:`, actualFonts);
    } else if (property === 'transition') {
      isMatch = actualValue.trim().startsWith(expectedValue.replace(' ease', '').trim());
    } else {
      isMatch = actualValue.trim() === expectedValue.trim();
    }
    
    console.log(`🧪 ${selector} ${property} → Expected: ${expectedValue}, Found: ${actualValue}`);
    expectedFound.push({ selector: selector, property: property, expectedValue: expectedValue, actualValue: actualValue });

    return isMatch;
  }

  // Color helper functions
  const hexToRgb = hex => {
    if (!hex) throw new Error('hexToRgb: expected a valid hex color but got undefined');
    const bigint = parseInt(hex.replace('#', ''), 16);
    return `rgb(${(bigint >> 16) & 255}, ${(bigint >> 8) & 255}, ${bigint & 255})`;
  };

  function normalizeRgbString(rgbStr) {
    const match = rgbStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    return match ? `rgb(${match[1]}, ${match[2]}, ${match[3]})` : null;
  }

  const extractRgbOnly = rgbaString => {
    const match = rgbaString.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    return match ? `rgb(${match[1]}, ${match[2]}, ${match[3]})` : null;
  };
  
  // Check element color function
  async function checkElementColor(page, selector, expectedHexColor) {
    const element = await page.$(selector);
    if (!element) {
      console.log(`❌ Element "${selector}" not found.`);
      return false;
    }
    const actualColor = await page.$eval(selector, el =>
      getComputedStyle(el).backgroundColor
    );
    const expectedColor = hexToRgb(expectedHexColor);
    
    console.log(`🎨 ${selector} → Expected: ${expectedColor}, Found: ${actualColor}`);
    return actualColor === expectedColor;
  }
  
  // Check hover color function
  async function checkHoverColor(page, selector, expectedHexColor) {
    await page.hover(selector);
    await page.waitForTimeout(500);
    const actualColor = await page.$eval(selector, el =>
      getComputedStyle(el).backgroundColor
    );
  
    const actualRGB = extractRgbOnly(actualColor);
    const expectedRGB = hexToRgb(expectedHexColor);
    console.log(`🎯 Hover ${selector} → Expected: ${expectedRGB}, Found: ${actualRGB}`);
    return actualRGB === expectedRGB;
  }

  // Run the tests
  const responsivenessResult = await responsivenessTest();
  const performanceResult = await performanceTest();

  const classifications = [
    // Essentials
    {
      name: 'Concurrent Load Time',
      selector: 'html',
      score: performanceResult.score || 0,  // from load test
      category: 'Code Structure & Cleanliness',
      check: performanceTest
    },
      {
        name: 'Responsiveness',
        selector: 'body',
        score: responsivenessResult.score || 0,  // from viewport checks
        category: 'Code Structure & Cleanliness',
        check: responsivenessTest
      },
       {
        name: 'Background Image Min height',
        selector: '.backgroundpart',
        property: 'padding',
        expectedValue: '20px',
        score: 5,
        category: 'CSS Expertise',
        check: (page, selector, _, property = 'padding', expectedValue = '20px') =>
                checkCssProperty(page, selector, property, expectedValue),
      },
      {
        name: 'Background Image - Positioning with display',
        selector: '.backgroundpart',
        property: 'display',
        expectedValue: 'flex',
        score: 5,
        category: 'CSS Expertise',
        check: (page, selector, _, property = 'display', expectedValue = 'flex') =>
                checkCssProperty(page, selector, property, expectedValue),
      },
      {
        name: 'Card Allignment - Horizantal',
        selector: '.backgroundpart',
        property: 'justify-content',
        expectedValue: 'center',
        score: 5,
        category: 'CSS Expertise',
        check: (page, selector, _, property = 'justify-content', expectedValue = 'center') =>
                checkCssProperty(page, selector, property, expectedValue),
      },
      {
        name: 'Card allignment - Vertical ',
        selector: '.backgroundpart',
        property: 'align-items',
        expectedValue: 'center',
        score: 5,
        category: 'CSS Expertise',
        check: (page, selector, _, property = 'align-items', expectedValue = 'center') =>
                checkCssProperty(page, selector, property, expectedValue),
      },
      {
        name: 'Card rounded corner',
        selector: '.contentcard',
        property: 'border-radius',
        expectedValue: '15px',
        score: 5,
        category: 'CSS Expertise',
        check: (page, selector, _, property = 'border-radius', expectedValue = '15px') =>
                checkCssProperty(page, selector, property, expectedValue),
      },
      {
        name: 'Card padding',
        selector: '.contentcard',
        property: 'padding',
        expectedValue: '30px 20px',
        score: 5,
        category: 'CSS Expertise',
        check: (page, selector, _, property = 'padding', expectedValue = '30px 20px') =>
                checkCssProperty(page, selector, property, expectedValue),
      },
      {
        name: 'Card Width - Responsive',
        selector: '.contentcard',
        property: 'max-width',
        expectedValue: '400px',
        score: 5,
        category: 'CSS Expertise',
        check: (page, selector, _, property = 'max-width', expectedValue = '400px') =>
                checkCssProperty(page, selector, property, expectedValue),
      },
      {
        name: 'Card Text alignment',
        selector: '.contentcard',
        property: 'text-align',
        expectedValue: 'center',
        score: 5,
        category: 'CSS Expertise',
        check: (page, selector, _, property = 'text-align', expectedValue = 'center') =>
                checkCssProperty(page, selector, property, expectedValue),
      },
      {
        name: 'Profile Picture width ',
        selector: '.profile-pic',
        property: 'width',
        expectedValue: '100px',
        score: 5,
        category: 'CSS Expertise',
        check: (page, selector, _, property = 'width', expectedValue = '100px') =>
                checkCssProperty(page, selector, property, expectedValue),
      },
      {
        name: 'Profile Picture - Height',
        selector: '.profile-pic',
        property: 'height',
        expectedValue: '100px',
        score: 5,
        category: 'CSS Expertise',
        check: (page, selector, _, property = 'height', expectedValue = '100px') =>
                checkCssProperty(page, selector, property, expectedValue),
      },
      {
        name: ' Profile Picture - Rounded Corner',
        selector: '.profile-pic',
        property: 'border-radius',
        expectedValue: '50%',
        score: 5,
        category: 'CSS Expertise',
        check: (page, selector, _, property = 'border-radius', expectedValue = '50%') =>
                checkCssProperty(page, selector, property, expectedValue),
      },
      {
        name: 'CSS Style - Smoothness & Performance',
        selector: '.gift-img',
        property: 'width',
        expectedValue: '80px',
        score: 5,
        category: 'CSS Expertise',
        check: (page, selector, _, property = 'width', expectedValue = '80px') =>
                checkCssProperty(page, selector, property, expectedValue),
      },
      {
        name: 'Aesthetics Elements',
        selector: '.contentcard',
        property: 'background-color',
        expectedColor: 'rgb(230, 249, 252)',
        score: 5,
        category: 'CSS Expertise',
        check: (page, selector, _, property = 'background-color', expectedValue = 'rgb(230, 249, 252)') =>
                checkCssProperty(page, selector, property, expectedValue),
      },
    // {
    //   name: 'HTML Semantics - Basic Structure - HTML Structure Validation',
    //   selector: 'html',
    //   score: 5,
    //   category: 'Required',
    //   check: checkHtmlStructure
    // },
    {
      name: 'CSS - Structure of a Page',
      selector: '.backgroundpart',
      property: 'background-size',
      expectedValue: 'cover',
      score: 5,
      category: 'CSS Expertise',
      check: (page, selector, _, property = 'background-size', expectedValue = 'cover') =>
        checkCssProperty(page, selector, property, expectedValue),
    },
    {
        name: 'Java Script - Data Handling',
        selector: 'html',
        score: 5,  // from load test
        category: 'Java Script ',
        check: datahandling
      },
      {
        name: 'Java Script - Event Handling',
        selector: 'html',
        score: 5,  // from load test
        category: 'Java Script ',
        check: eventhandling
      },
  ];

  const scoreByCategory = {};
  const maxScoreByCategory = {}; // To keep track of max score for each category
  const detailedResults = [];

  for (const rule of classifications) {
    const result = await rule.check(page, rule.selector, rule.expectedColor || rule.expectedValue);
    if (!scoreByCategory[rule.category]) {
      scoreByCategory[rule.category] = 0;
      maxScoreByCategory[rule.category] = 0; // Initialize max score for category
    }

    // Add the rule score to the total and the max score to the max score for the category
    maxScoreByCategory[rule.category] += rule.score;

      // Find the corresponding entry in expectedFound for CSS property checks
  const logEntry = expectedFound.find(
    (entry) =>
      entry.selector === rule.selector &&
      entry.property === rule.property &&
      entry.expectedValue === rule.expectedValue
  );

    if (result) {
      console.log(`✅ Passed: ${rule.name} (+${rule.score})`);
      scoreByCategory[rule.category] += rule.score;
      detailedResults.push({
        category: rule.category,
        name: rule.name,
        score: rule.score,
        ReviewDetails: {
          selector: rule.selector,
          property: rule.property,
          expectedValue: logEntry?.expectedValue,
          actualValue: logEntry ? logEntry.actualValue : null // Use the actual value from expectedFound
        }
      });
    } else {
      console.log(`❌ Failed: ${rule.name}`);
      detailedResults.push({
        category: rule.category,
        name: rule.name,
        score: 0,
        ReviewDetails: {
          selector: rule.selector,
          property: rule.property,
          expectedValue: logEntry?.expectedValue,
          actualValue: logEntry ? logEntry.actualValue : null // Use the actual value from expectedFound
        }
      });
    }
  }

  const finalReport = {
    AvgLoadTime: performanceResult.averageLoadTime, // included inside JSON file
    EvaluationDetails: detailedResults
  };

  console.log(`\n⏱️ Average Load Time: ${performanceResult.averageLoadTime} ms`);

  await browser.close();
  return {
    AvgLoadTime: performanceResult.averageLoadTime, 
    EvaluationDetails: detailedResults,
  };
}
// })();
module.exports = { a1l1q1 };
