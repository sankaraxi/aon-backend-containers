const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function a1l1q3(id, framework, outputPort) {
  console.log(id, framework);

  // Define base URL based on framework
  // let baseURL = 'http://localhost:5273'; // Default to React 8
  let baseURL = '';

   if (outputPort) {
    // baseURL = `http://localhost:${outputPort}`;
    baseURL = `http://localhost:${outputPort}/out/${outputPort}`;
  }

  // if (id === '8' && framework === 'react') {
  //   baseURL = 'http://localhost:5173';
  // } else if (id === '8' && framework === 'vue') {
  //   baseURL = 'http://localhost:5174';
  // } else if (id === '11' && framework === 'react') {
  //   baseURL = 'http://localhost:5183';
  // } else if (id === '11' && framework === 'vue') {
  //   baseURL = 'http://localhost:5184';
  // } else if (id === '14' && framework === 'react') {
  //   baseURL = 'http://localhost:5189';
  // } else if (id === '14' && framework === 'vue') {
  //   baseURL = 'http://localhost:5190';
  // }

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(baseURL);

  
  // Intercept navigation to prevent reload
  await page.route('**/*', route => {
    if (route.request().resourceType() === 'document' && route.request().url() === baseURL) {
      route.abort(); // Prevent reload
    } else {
      route.continue();
    }
  });

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
    const score = Math.round((passed / total) * 20);

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

    const response = await fetch('https://fakestoreapi.com/products');
    const data = await response.json();
    const expectedCount = data.length;

    const result = await page.evaluate(() => {
      const label = document.querySelector('label');
      const debug = {
        labelExists: !!label,
        labelText: '',
        numberInLabel: null
      };

      if (label) {
        const text = label.textContent || '';
        debug.labelText = text;
        const match = text.match(/\d+/);
        if (match) {
          debug.numberInLabel = parseInt(match[0], 10);
        }
      }

      return debug;
    });

    console.log("Label Found:", result.labelExists);
    console.log("Label Text:", result.labelText);
    console.log("Number Found in Label:", result.numberInLabel);
    console.log("Expected Product Count:", expectedCount);

    return result.labelExists && result.numberInLabel === expectedCount;
  }

  // CSS property check function
  async function checkCssProperty(page, selector, property, expectedValue) {
    try {
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
        isMatch = expectedFonts.every(font => actualFonts.includes(font));

        console.log(`🎯 Expected font stack:`, expectedFonts);
        console.log(`🎯 Actual font stack:`, actualFonts);
      } else if (property === 'transition') {
        isMatch = actualValue.trim().startsWith(expectedValue.replace(' ease', '').trim());
      } else if (property === 'border') {
        isMatch = actualValue.trim() === expectedValue.trim();
      } else {
        isMatch = actualValue.trim() === expectedValue.trim();
      }

      console.log(`🧪 ${selector} ${property} → Expected: ${expectedValue}, Found: ${actualValue}`);
      expectedFound.push({ selector, property, expectedValue, actualValue });
      return isMatch;
    } catch (error) {
      console.log(`❌ Error in checkCssProperty for ${selector}: ${error.message}`);
      return false;
    }
  }

  // Color helper functions
  const hexToRgb = hex => {
    if (!hex) throw new Error('hexToRgb: expected a valid hex color but got undefined');
    const bigint = parseInt(hex.replace('#', ''), 16);
    return `rgb(${(bigint >> 16) & 255}, ${(bigint >> 8) & 255}, ${bigint & 255})`;
  };

  const extractRgbOnly = rgbaString => {
    const match = rgbaString.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    return match ? `rgb(${match[1]}, ${match[2]}, ${match[3]})` : null;
  };

  // Check element color function
  async function checkElementColor(page, selector, expectedHexColor, property = 'backgroundColor') {
    try {
      const element = await page.$(selector);
      if (!element) {
        console.log(`❌ Element "${selector}" not found.`);
        return false;
      }
      const actualColor = await page.$eval(selector, (el, prop) =>
        getComputedStyle(el)[prop], property);
      const expectedColor = hexToRgb(expectedHexColor);

      console.log(`🎨 ${selector} ${property} → Expected: ${expectedColor}, Found: ${actualColor}`);
      expectedFound.push({ selector, expectedValue: expectedColor, actualValue: actualColor, property });
      return actualColor === expectedColor;
    } catch (error) {
      console.log(`❌ Error in checkElementColor for ${selector}: ${error.message}`);
      return false;
    }
  }

  // Check hover color function
  async function checkHoverColor(page, selector, expectedHexColor) {
    try {
      await page.hover(selector);
      await page.waitForTimeout(500);
      const actualColor = await page.$eval(selector, el =>
        getComputedStyle(el).backgroundColor
      );

      const actualRGB = extractRgbOnly(actualColor);
      const expectedRGB = hexToRgb(expectedHexColor);
      console.log(`🎯 Hover ${selector} → Expected: ${expectedRGB}, Found: ${actualRGB}`);
      return actualRGB === expectedRGB;
    } catch (error) {
      console.log(`❌ Error in checkHoverColor for ${selector}: ${error.message}`);
      return false;
    }
  }

// JavaScript functionality tests
  async function checkPrintData(page) {
    try {
      const printButton = await page.$('.printbtn');
      if (!printButton) {
        console.log('❌ Print button not found');
        return false;
      }
      await printButton.click();
      await page.waitForSelector('.preview-card', { state: 'visible', timeout: 2000 });
      const preview = await page.$('.preview-card');
      const isVisible = preview && (await preview.isVisible());
      if (!isVisible) {
        console.log('❌ Preview card not visible after print button click');
        return false;
      }
      const previewContent = await preview.textContent();
      const hasCorrectData = previewContent.includes('Jack') &&
                            previewContent.includes('jackdaniel45@gmail.com') &&
                            previewContent.includes('Mumbai') &&
                            previewContent.includes('8989787878');
      console.log(`🧪 Print Data → Preview visible: ${isVisible}, Correct data: ${hasCorrectData}`);
      return isVisible && hasCorrectData;
    } catch (error) {
      console.log(`❌ Error in checkPrintData: ${error.message}`);
      return false;
    }
  }

  async function checkSaveData(page) {
    try {
      const saveButton = await page.$('.savebtn');
      if (!saveButton) {
        console.log('❌ Save button not found');
        return false;
      }
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 5000 }),
        saveButton.click()
      ]);
      const stream = await download.createReadStream();
      let content = '';
      stream.on('data', data => content += data.toString());
      await new Promise(resolve => stream.on('end', resolve));
      try {
        const json = JSON.parse(content);
        const expectedData = {
          name: "Jack",
          email: "jackdaniel45@gmail.com",
          location: "Mumbai",
          phone: "8989787878",
          skills: []
        };
        const isValid = json.name === expectedData.name &&
                        json.email === expectedData.email &&
                        json.location === expectedData.location &&
                        json.phone === expectedData.phone &&
                        Array.isArray(json.skills);
        console.log(`🧪 Save Data → Valid JSON: ${isValid}`);
        return isValid;
      } catch (e) {
        console.log(`❌ Save Data → Invalid JSON: ${e.message}`);
        return false;
      }
    } catch (error) {
      console.log(`❌ Error in checkSaveData: ${error.message}`);
      return false;
    }
  }

  async function checkThemeToggle(page) {
    try {
      const toggleButton = await page.$('.toggle-theme-btn');
      if (!toggleButton) {
        console.log('❌ Theme toggle button not found');
        return false;
      }
      const initialBg = await page.$eval('.skillset-theme-container', el =>
        getComputedStyle(el).backgroundColor);
      await toggleButton.click();
      await page.waitForTimeout(1000);
      const newBg = await page.$eval('.skillset-theme-container', el =>
        getComputedStyle(el).backgroundColor);
      const isToggled = initialBg !== newBg;
      console.log(`🧪 Theme Toggle → Initial BG: ${initialBg}, New BG: ${newBg}, Toggled: ${isToggled}`);
      return isToggled;
    } catch (error) {
      console.log(`❌ Error in checkThemeToggle: ${error.message}`);
      return false;
    }
  }

  async function checkThemePersistence(page, context) {
    try {
      const toggleButton = await page.$('.toggle-theme-btn');
      if (!toggleButton) {
        console.log('❌ Theme toggle button not found');
        return false;
      }
      await toggleButton.click();
      await page.waitForTimeout(1000);
      const darkBg = await page.$eval('.skillset-theme-container', el =>
        getComputedStyle(el).backgroundColor);

      const newPage = await context.newPage();
      await newPage.goto(baseURL);
      await newPage.waitForTimeout(1000);
      const reloadedBg = await newPage.$eval('.skillset-theme-container', el =>
        getComputedStyle(el).backgroundColor);
      await newPage.close();
      const isPersistent = darkBg === reloadedBg && darkBg === 'rgb(30, 30, 30)';
      console.log(`🧪 Theme Persistence → Dark BG: ${darkBg}, Reloaded BG: ${reloadedBg}, Persistent: ${isPersistent}`);
      return isPersistent;
    } catch (error) {
      console.log(`❌ Error in checkThemePersistence: ${error.message}`);
      return false;
    }
  }

 async function checkRealTimeUpdate(page) {
  try {
    // Debug: Log page content to verify DOM state
    const pageContent = await page.content();
    console.log('🔍 checkRealTimeUpdate: Page content length:', pageContent.length);

    // Wait for Add Skill button and verify it exists
    await page.waitForSelector('.add-skill-btn', { state: 'visible', timeout: 10000 });
    const addSkillButton = await page.$('.add-skill-btn');
    if (!addSkillButton) {
      console.log('❌ Add Skill button not found');
      return false;
    }
    console.log('✅ Found Add Skill button');

    // Click Add Skill button and wait for skill input
    await addSkillButton.click();
    await page.waitForSelector('.skill-input', { state: 'visible', timeout: 10000 });
    const input = await page.$('.skill-input');
    if (!input) {
      console.log('❌ Skill input not found');
      return false;
    }
    console.log('✅ Found skill input');

    // Fill input with TestSkill
    await input.fill('TestSkill');

    // Wait for Confirm Add button and verify it exists
    await page.waitForSelector('.confirm-add-btn', { state: 'visible', timeout: 10000 });
    const addButton = await page.$('.confirm-add-btn');
    if (!addButton) {
      console.log('❌ Confirm Add button not found');
      return false;
    }
    console.log('✅ Found Confirm Add button');

    // Click Confirm Add button and wait for skill tag
    await addButton.click();
    await page.waitForSelector('.skill-tag', { state: 'visible', timeout: 10000 });

    // Verify skill tag content using evaluate to avoid page.$ issues
    const skillText = await page.evaluate(() => {
      const tag = document.querySelector('.skill-tag');
      return tag ? tag.textContent : null;
    });
    if (!skillText) {
      console.log('❌ Skill tag not found after adding skill');
      return false;
    }
    const isUpdated = skillText.includes('TestSkill');
    console.log(`🎯 Real-Time Update → Expected: TestSkill, Found: ${skillText}, Updated: ${isUpdated}`);
    return isUpdated;
  } catch (error) {
    console.log(`❌ Error in checkRealTimeUpdate: ${error.message}`);
    return false;
  }
}

 async function checkAddSkillButton(page) {
    const button = await page.$('.add-skill-btn');
    if (!button) {
      console.log('❌ Add Skill button not found');
      return false;
    }
    await button.click();
    await page.waitForTimeout(500);
    const input = await page.$('.skill-input');
    const isVisible = input && (await input.isVisible());
    console.log(`🧪 Add Skill button click → Input visible: ${isVisible}`);
    return isVisible;
  }

    async function checkSkillRemoval(page) {
    const input = await page.$('.skill-input');
    if (!input) {
      console.log('❌ Skill input not found');
      return false;
    }
    await input.fill('TestSkill');
    const addButton = await page.$('.confirm-add-btn');
    if (!addButton) {
      console.log('❌ Confirm Add button not found');
      return false;
    }
    await addButton.click();
    await page.waitForTimeout(500);
    const removeTag = await page.$('.remove-tag');
    if (!removeTag) {
      console.log('❌ Remove tag not found');
      return false;
    }
    const skillCountBefore = await page.$$eval('.skill-tag', els => els.length);
    await removeTag.click();
    await page.waitForTimeout(500);
    const skillCountAfter = await page.$$eval('.skill-tag', els => els.length);
    const isRemoved = skillCountBefore > skillCountAfter;
    console.log(`🧪 Skill removal → Before: ${skillCountBefore}, After: ${skillCountAfter}`);
    return isRemoved;
  }


  async function checkEdgeCases(page) {
    try {
      await page.click('.add-skill-btn');
      const input = await page.$('.skill-input');
      if (!input) {
        console.log('❌ Skill input not found');
        return false;
      }
      await input.fill('');
      const addButton = await page.$('.confirm-add-btn');
      if (!addButton) {
        console.log('❌ Confirm Add button not found');
        return false;
      }
      const initialSkillCount = await page.$$eval('.skill-tag', els => els.length);
      await addButton.click();
      await page.waitForTimeout(500);
      const afterEmptySkillCount = await page.$$eval('.skill-tag', els => els.length);
      const handlesEmptyInput = initialSkillCount === afterEmptySkillCount;

      await input.fill('RapidSkill');
      await Promise.all([
        addButton.click(),
        addButton.click(),
        addButton.click()
      ]);
      await page.waitForTimeout(500);
      const afterRapidSkillCount = await page.$$eval('.skill-tag', els => els.length);
      const handlesRapidClicks = afterRapidSkillCount === initialSkillCount + 1;

      console.log(`🧪 Edge Cases → Empty Input Handled: ${handlesEmptyInput}, Rapid Clicks Handled: ${handlesRapidClicks}`);
      return handlesEmptyInput && handlesRapidClicks;
    } catch (error) {
      console.log(`❌ Error in checkEdgeCases: ${error.message}`);
      return false;
    }
  }

  const expectedFound = [];

  const responsivenessResult = await responsivenessTest();
  const performanceResult = await performanceTest();

  const classifications = [
    // Efficiency Tests
    {
      name: 'Concurrent Load Time',
      selector: 'html',
      score: performanceResult.score || 0,
      category: 'Code Structure & Cleanliness',
      check: performanceTest
    },
    {
      name: 'Responsiveness',
      selector: 'body',
      score: responsivenessResult.score || 0,
      category: 'Code Structure & Cleanliness',
      check: responsivenessTest
    },
    // CSS Property Tests
    {
      name: 'Light Theme - Color',
      selector: '.light-theme',
      property: 'color',
      expectedValue: 'rgb(0, 0, 0)',
      score: 5,
      category: 'CSS Expertise',
      check: (page, selector, _, property = 'color', expectedValue = 'rgb(0, 0, 0)') =>
        checkElementColor(page, selector, '#000000', 'color'),
      expectedColor: '#000000'
    },
    {
      name: 'Light Theme - Background Color',
      selector: '.light-theme',
      property: 'backgroundColor',
      expectedValue: 'rgb(255, 255, 255)',
      score: 5,
      category: 'CSS Expertise',
      check: checkElementColor,
      expectedColor: '#ffffff'
    },
    {
      name: 'Dark Theme - Color',
      selector: '.dark-theme',
      property: 'color',
      expectedValue: 'rgb(241, 241, 241)',
      score: 5,
      category: 'CSS Expertise',
      check: async (page, selector, expectedColor) => {
        await page.click('.toggle-theme-btn');
        await page.waitForTimeout(500);
        return checkElementColor(page, selector, expectedColor, 'color');
      },
      expectedColor: '#f1f1f1'
    },
    {
      name: 'Layout - Flex Direction',
      selector: '.main-layout',
      property: 'gap',
      expectedValue: '32px',
      score: 5,
      category: 'CSS Expertise',
      check: (page, selector, _, property = 'gap', expectedValue = '32px') =>
        checkCssProperty(page, selector, property, expectedValue),
    },
    {
      name: 'Profile Card Width - Max Width',
      selector: '.flexarea',
      property: 'max-width',
      expectedValue: '400px',
      score: 5,
      category: 'CSS Expertise',
      check: (page, selector, _, property = 'max-width', expectedValue = '400px') =>
        checkCssProperty(page, selector, property, expectedValue),
    },
    {
      name: 'Card Preview - Opacity',
      selector: '.profile-img',
      property: 'border-radius',
      expectedValue: '50%',
      score: 5,
      category: 'CSS Expertise',
      check: (page, selector, _, property = 'border-radius', expectedValue = '50%') =>
        checkCssProperty(page, selector, property, expectedValue),
    },
    {
      name: 'Profile Card - Padding',
      selector: '.profile-card',
      property: 'padding',
      expectedValue: '20px',
      score: 5,
      category: 'CSS Expertise',
      check: (page, selector, _, property = 'padding', expectedValue = '20px') =>
        checkCssProperty(page, selector, property, expectedValue),
    },
    {
      name: 'Header Section - Background Color',
      selector: '.header-section',
      property: 'backgroundColor',
      expectedValue: 'rgb(108, 52, 131)',
      score: 5,
      category: 'CSS Expertise',
      check: checkElementColor,
      expectedColor: '#6c3483'
    },
    // JavaScript Functionality Tests
        {
      name: 'Add Skill Button Functionality',
      selector: '.add-skill-btn',
      score: 10,
      category: 'Java Script',
      check: checkAddSkillButton
    },
    {
      name: 'Skill Removal Functionality',
      selector: '.remove-tag',
      score: 10,
      category: 'Java Script',
      check: checkSkillRemoval
    },
    {
      name: 'Print Data Functionality',
      selector: '.printbtn',
      score: 10,
      category: 'Java Script',
      check: checkPrintData
    },
    {
      name: 'Save Data Functionality',
      selector: '.savebtn',
      score: 10,
      category: 'Java Script',
      check: checkSaveData
    },
    // {
    //   name: 'Theme Toggle Functionality',
    //   selector: '.toggle-theme-btn',
    //   score: 10,
    //   category: 'Functionality',
    //   check: checkThemeToggle
    // },
    // // {
    // //   name: 'Theme Persistence Functionality',
    // //   selector: '.skillset-theme-container',
    // //   score: 10,
    // //   category: 'Functionality',
    // //   check: (page) => checkThemePersistence(page, context)
    // // },
    {
      name: 'Real-Time Update Functionality',
      selector: '.skill-tag',
      score: 10,
      category: 'Java Script',
      check: checkRealTimeUpdate
    },
    {
      name: 'Edge Cases Handling',
      selector: '.skill-input',
      score: 10,
      category: 'Java Script',
      check: checkEdgeCases
    },
    // // HTML Semantics
    // {
    //   name: 'HTML Semantics - Basic Structure',
    //   selector: 'html',
    //   score: 5,
    //   category: 'Required',
    //   check: checkHtmlStructure
    // }
  ];

  const scoreByCategory = {};
  const maxScoreByCategory = {};
  const detailedResults = [];

  for (const rule of classifications) {
    const result = await rule.check(page, rule.selector, rule.expectedColor || rule.expectedValue);
    if (!scoreByCategory[rule.category]) {
      scoreByCategory[rule.category] = 0;
      maxScoreByCategory[rule.category] = 0;
    }

    maxScoreByCategory[rule.category] += rule.score;

    const logEntry = expectedFound.find(
      (entry) =>
        entry.selector === rule.selector &&
        (entry.property === rule.property || (rule.expectedColor && entry.expectedValue === hexToRgb(rule.expectedColor)))
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
          expectedValue: logEntry?.expectedValue || rule.expectedValue,
          actualValue: logEntry?.actualValue || null
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
          expectedValue: logEntry?.expectedValue || rule.expectedValue,
          actualValue: logEntry?.actualValue || null
        }
      });
    }
  }

  const finalReport = {
    AvgLoadTime: performanceResult.averageLoadTime,
    EvaluationDetails: detailedResults
  };

  console.log(`\n⏱️ Average Load Time: ${performanceResult.averageLoadTime} ms`);

  await browser.close();
  return {
    AvgLoadTime: performanceResult.averageLoadTime,
    EvaluationDetails: detailedResults
  };
}

module.exports = { a1l1q3 };