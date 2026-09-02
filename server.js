import express from 'express';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import * as cheerio from 'cheerio';

const app = express();
app.use(express.json());

const CMA_URL = 'https://life.cma.gov.il/RiskParameters/RiskParameters?id=84300001';
const CACHE_TTL = 30000;
const CMA_REQUEST_INTERVAL = 5000;
const resultCache = new Map();
let lastCmaRequestAt = 0;

function formatNIS(value) {
  const n = typeof value === 'number' ? value : parseFloat(value || '');
  if (Number.isNaN(n)) return '';
  return new Intl.NumberFormat('he-IL', {
    style: 'currency', currency: 'ILS',
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(n);
}

function birthDateFromAge(age) {
  const now = new Date();
  const d = new Date(now.getFullYear() - age, now.getMonth(), now.getDate());
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function launchBrowser() {
  return puppeteer.launch({
    args: [...chromium.args, '--disable-blink-features=AutomationControlled', '--no-sandbox'],
    defaultViewport: { width: 1366, height: 768 },
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });
}

async function generateCmaPrices(params) {
  const { age, gender, smoking, insuranceAmount, period = 20, premiumType = 84100001 } = params;
  const cacheKey = JSON.stringify({ age, gender, smoking, insuranceAmount, period, premiumType });
  const cached = resultCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL) return cached.rows;

  const birthDate = birthDateFromAge(age);
  const genderCode = gender === 'female' ? 84400002 : 84400001;
  let lastError = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 3000));
    const now = Date.now();
    const waitUntil = lastCmaRequestAt + CMA_REQUEST_INTERVAL;
    if (now < waitUntil) await new Promise((r) => setTimeout(r, waitUntil - now));

    const browser = await launchBrowser();
    try {
      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36');
      await page.goto(CMA_URL, { waitUntil: 'networkidle2', timeout: 60000 });
      await page.waitForSelector('#uiBtnCalc', { visible: true, timeout: 15000 }).catch(() => {});

      let resultHtml = '';
      const done = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('CMA request timeout')), 30000);
        page.on('response', async (res) => {
          const request = res.request();
          if (request.url().includes('CalculateRiskRates') && request.method() === 'POST') {
            try {
              clearTimeout(timer);
              const status = res.status();
              resultHtml = await res.text();
              if (!res.ok()) { reject(new Error(`CMA returned ${status}`)); return; }
              resolve();
            } catch (e) { reject(new Error('Failed to read CMA response: ' + e.message)); }
          }
        });
      });

      await page.evaluate(
        (premiumType, genderCode, birthDate, smoking, desiredSum, desiredPeriod) => {
          const d = new Date(birthDate + 'T12:00:00');
          const p = window.ParametersModel?.Parameters;
          if (p) {
            p.set('PremiumType', premiumType);
            p.set('DesiredSum', desiredSum);
            p.set('DesiredPeriod', desiredPeriod);
          }
          const $ = window.$ || window.jQuery;
          if ($) {
            const setNumeric = (selector, value) => {
              const el = $(selector);
              if (!el.length) return;
              const widget = el.data('kendoNumericTextBox');
              if (widget && widget.value) widget.value(value);
              el.val(String(value)).trigger('change').trigger('input');
            };
            setNumeric('#uiLDesiredSum', desiredSum);
            setNumeric('#uiLDesiredPeriod', desiredPeriod);
          }
          const insured = p?.ListOfInsured?.[0];
          if (insured) {
            insured.set('BirthDate', d);
            insured.set('Gender', genderCode);
            insured.set('IsSmoking', smoking);
          }
          document.querySelector('#uiBtnCalc')?.click();
        },
        premiumType, genderCode, birthDate, smoking, insuranceAmount, period
      ).catch(() => {});

      await done;

      const $ = cheerio.load(resultHtml);
      const rows = [];
      $('.rowWrapp.terminal').each((_, el) => {
        const $el = $(el);
        const first = parseFloat($el.attr('data-first') || '');
        rows.push({
          company: $el.attr('data-companyname') || '',
          monthlyPremium: formatNIS(first),
          annualPremium: formatNIS(first * 12),
          total: formatNIS($el.attr('data-accum') || ''),
        });
      });

      if (rows.length > 0) {
        resultCache.set(cacheKey, { rows, at: Date.now() });
        lastCmaRequestAt = Date.now();
        return rows;
      }
      lastError = new Error('CMA returned no results');
    } catch (err) {
      lastError = err;
    } finally {
      lastCmaRequestAt = Date.now();
      await browser.close();
    }
  }
  throw lastError || new Error('CMA fetch failed after retries');
}

// DEBUG endpoint
app.get('/api/debug', async (req, res) => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36');
    const resp = await page.goto(CMA_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    const status = resp?.status();
    const title = await page.title().catch(() => '');
    const url = page.url();
    const diag = await page.evaluate(() => {
      return {
        hasJQuery: !!window.$ || !!window.jQuery,
        hasParametersModel: !!window.ParametersModel,
        hasCalcBtn: !!document.querySelector('#uiBtnCalc'),
        hasDesiredSum: !!document.querySelector('#uiLDesiredSum'),
        hasDesiredPeriod: !!document.querySelector('#uiLDesiredPeriod'),
        bodyTextSnippet: (document.body?.innerText || '').slice(0, 500),
      };
    }).catch((e) => ({ evalError: e.message }));
    return res.json({ status, title, url, diag });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  } finally {
    await browser.close();
  }
});

app.post('/api/cma', async (req, res) => {
  try {
    const { age, gender, smoking, insuranceAmount, period } = req.body;
    if (!age || !insuranceAmount) return res.status(400).json({ error: 'חסרים פרמטרים' });
    const rows = await generateCmaPrices({ age, gender, smoking, insuranceAmount, period });
    res.json({ rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`CMA scraper running on port ${PORT}`));
