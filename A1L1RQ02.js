const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function a1l1q2(id, framework,outputPort) {
  console.log(id, framework);

  console.log('Starting A1L1RQ02 assessment...');
  console.log('OutPort', outputPort);

  // Define base URL based on framework
  // let baseURL = 'http://localhost:5765';
  let baseURL = '';

  if (outputPort) {
    // baseURL = `http://localhost:${outputPort}`;
    baseURL = `http://localhost:${outputPort}/out/${outputPort}`;
    console.log('Using provided outputPort:', outputPort);
  }


  // if (id === '7' && framework === 'react') {
  //   baseURL = 'http://localhost:5175';
  // } else if (id === '7' && framework === 'vue') {
  //   baseURL = 'http://localhost:5176';
  // } else if (id === '10' && framework === 'react') {
  //   baseURL = 'http://localhost:5181';
  // } else if (id === '10' && framework === 'vue') {
  //   baseURL = 'http://localhost:5182';
  // } else if (id === '13' && framework === 'react') {
  //   baseURL = 'http://localhost:5187';
  // } else if (id === '13' && framework === 'vue') {
  //   baseURL = 'http://localhost:5188';
  // }

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
    const score = Math.round((passed / total) * 20); // Score out of 20

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
      const debug = {
        labelExists: !!label,
        labelText: '',
        containsText: false
      };

      if (label) {
        const text = label.textContent || '';
        debug.labelText = text;
        debug.containsText = text.includes("Designed and Developed by");
      }

      return debug;
    });

    console.log("Label Found:", result.labelExists);
    console.log("Label Text:", result.labelText);
    console.log("Contains Required Text:", result.containsText);

    return result.labelExists && result.containsText;
  }

  // CSS property check function
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
  async function checkElementColor(page, selector, expectedHexColor) {
    const element = await page.$(selector);
    if (!element) {
      console.log(`❌ Element "${selector}" not found.`);
      return false;
    }
    const actualColor = await page.$eval(selector, el =>
      getComputedStyle(el).color || getComputedStyle(el).backgroundColor
    );
    const expectedColor = hexToRgb(expectedHexColor);

    console.log(`🎨 ${selector} → Expected: ${expectedColor}, Found: ${actualColor}`);
    expectedFound.push({ selector, expectedValue: expectedColor, actualValue: actualColor });
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

  // JavaScript functionality tests
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

  async function checkSkillDisplay(page) {
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
    const skillTag = await page.$('.skill-tag');
    const skillText = skillTag ? await skillTag.textContent() : '';
    const isDisplayed = skillText.includes('TestSkill');
    console.log(`🧪 Skill display → Expected: TestSkill, Found: ${skillText}`);
    return isDisplayed;
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

  

  const expectedFound = [];

  // Run the tests
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
      name: 'Profile Image - Border Radius',
      selector: '.profile-img',
      property: 'border-radius',
      expectedValue: '50%',
      score: 5,
      category: 'CSS Expertise',
      check: (page, selector, _, property = 'border-radius', expectedValue = '50%') =>
        checkCssProperty(page, selector, property, expectedValue),
    },
    {
      name: 'Profile Image - Border',
      selector: '.profile-img',
      property: 'border',
      expectedValue: '4px solid rgb(142, 68, 173)',
      score: 5,
      category: 'CSS Expertise',
      check: (page, selector, _, property = 'border', expectedValue = '4px solid rgb(142, 68, 173)') =>
        checkCssProperty(page, selector, property, expectedValue),
    },
    {
      name: 'Profile Card - Max Width',
      selector: '.profile-card',
      property: 'max-width',
      expectedValue: '600px',
      score: 5,
      category: 'CSS Expertise',
      check: (page, selector, _, property = 'max-width', expectedValue = '600px') =>
        checkCssProperty(page, selector, property, expectedValue),
    },
    {
      name: 'Profile Card - Color',
      selector: '.profile-card',
      property: 'color',
      expectedValue: 'rgb(91, 44, 111)',
      score: 5,
      category: 'CSS Expertise',
      check: checkElementColor,
      expectedColor: '#5b2c6f'
    },
    {
      name: 'Background Color - Body',
      selector: 'body',
      property: 'background-color',
      expectedValue: 'rgb(244, 236, 247)',
      score: 5,
      category: 'CSS Expertise',
      check: (page, selector, _, property = 'background-color', expectedValue = 'rgb(244, 236, 247)') =>
        checkCssProperty(page, selector, property, expectedValue),
    },
    {
      name: 'Profile Name - Font Size',
      selector: '.profile-name',
      property: 'font-size',
      expectedValue: '32px',
      score: 5,
      category: 'CSS Expertise',
      check: (page, selector, _, property = 'font-size', expectedValue = '32px') =>
        checkCssProperty(page, selector, property, expectedValue),
    },
    {
      name: 'Flex Area - Display',
      selector: '.flexarea',
      property: 'display',
      expectedValue: 'flex',
      score: 5,
      category: 'CSS Expertise',
      check: (page, selector, _, property = 'display', expectedValue = 'flex') =>
        checkCssProperty(page, selector, property, expectedValue),
    },
    {
      name: 'Flex Area - Text Align',
      selector: '.flexarea',
      property: 'text-align',
      expectedValue: 'center',
      score: 5,
      category: 'CSS Expertise',
      check: (page, selector, _, property = 'text-align', expectedValue = 'center') =>
        checkCssProperty(page, selector, property, expectedValue),
    },
    {
      name: 'Skill Tags Container - Display',
      selector: '.skill-tags-container',
      property: 'display',
      expectedValue: 'flex',
      score: 5,
      category: 'CSS Expertise',
      check: (page, selector, _, property = 'display', expectedValue = 'flex') =>
        checkCssProperty(page, selector, property, expectedValue),
    },
    {
      name: 'Header - Margin Bottom',
      selector: '.header-section',
      property: 'margin-bottom',
      expectedValue: '32px',
      score: 5,
      category: 'CSS Expertise',
      check: (page, selector, _, property = 'margin-bottom', expectedValue = '32px') =>
        checkCssProperty(page, selector, property, expectedValue),
    },
    {
      name: 'Skill Heading - Color',
      selector: '.skills-heading',
      property: 'color',
      expectedValue: 'rgb(142, 68, 173)',
      score: 5,
      category: 'CSS Expertise',
      check: checkElementColor,
      expectedColor: '#8e44ad'
    },
    {
      name: 'Skill Heading - Text Align',
      selector: '.skills-heading',
      property: 'text-align',
      expectedValue: 'center',
      score: 5,
      category: 'CSS Expertise',
      check: (page, selector, _, property = 'text-align', expectedValue = 'center') =>
        checkCssProperty(page, selector, property, expectedValue),
    },
    {
      name: 'Flex Area - Justify Content',
      selector: '.flexarea',
      property: 'justify-content',
      expectedValue: 'center',
      score: 5,
      category: 'CSS Expertise',
      check: (page, selector, _, property = 'justify-content', expectedValue = 'center') =>
        checkCssProperty(page, selector, property, expectedValue),
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
      name: 'Skill Display Functionality',
      selector: '.skill-tag',
      score: 10,
      category: 'Java Script',
      check: checkSkillDisplay
    },
    {
      name: 'Skill Removal Functionality',
      selector: '.remove-tag',
      score: 10,
      category: 'Java Script',
      check: checkSkillRemoval
    },
    // HTML Semantics
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

module.exports = { a1l1q2 };