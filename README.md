# CMA Scraper — שירות חיצוני להשוואת מחירי ביטוח חיים

שרת Node.js עם Puppeteer שמבצע סקרייפינג לאתר מחשבון הריסק הממשלתי ומחזיר מחירים מחברות הביטוח.

## פריסה ב-Render (מומלץ, חינמי)

1. צור חשבון ב-https://render.com
2. New → Web Service → "Build and deploy from a Git repository"
3. צור ריפו Git חדש (GitHub/GitLab), העלה את תוכן התיקיה הזו
4. בהגדרות:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Environment**: `Node`
5. לחץ Deploy
6. לאחר הפריסה תקבל כתובת כמו `https://cma-scraper-xxxx.onrender.com`

## פריסה ב-Railway

1. צור חשבון ב-https://railway.app
2. New Project → Deploy from GitHub repo
3. העלה את התיקיה לריפו Git וחבר
4. Railway יזהה אוטומטית `npm start`
5. תקבל כתובת כמו `https://cma-scraper-production.up.railway.app`

## בדיקה

```bash
curl -X POST https://YOUR-URL/api/cma \
  -H "Content-Type: application/json" \
  -d '{"age":35,"gender":"male","smoking":false,"insuranceAmount":1000000,"period":20}'
```

תשובה צפויה:
```json
{
  "rows": [
    { "company": "כלל", "monthlyPremium": "₪45.00", "annualPremium": "₪540.00", "total": "₪12,000.00" },
    ...
  ]
}
```

## חיבור למערכת InsureFlow Pro

לאחר הפריסה, העתק את הכתובת שקיבלת והדבק אותה בקובץ `src/lib/cmaConfig.js` בפרויקט הראשי:

```js
export const CMA_SCRAPER_URL = 'https://cma-scraper-xxxx.onrender.com/api/cma';
```

> הערה: הכתובת צריכה לכלול את הנתיב `/api/cma` בסוף.
