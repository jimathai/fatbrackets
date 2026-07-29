# FatBrackets Vercel deployment

## Local Git setup

```powershell
cd C:\Users\micro\Documents\fatbrackets
git init
git branch -M main
git remote add origin https://github.com/jimathai/fatbrackets.git
git add .
git commit -m "Initial FatBrackets deployment"
git push -u origin main
```

## Vercel

1. Import `jimathai/fatbrackets` as a new Vercel project.
2. Framework preset: Vite.
3. Build command: `npm run build`.
4. Output directory: `dist`.
5. Add environment variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
6. Deploy.

## Supabase Auth

In Authentication > URL Configuration:

- Site URL: `https://fatbrackets.com`
- Redirect URL: `https://fatbrackets.com/**`
- Redirect URL: `https://www.fatbrackets.com/**`
- Keep: `http://localhost:5173/**`

## Custom domain

In Vercel project Settings > Domains, add:

- `fatbrackets.com`
- `www.fatbrackets.com`

Use the exact DNS records Vercel displays in GoDaddy.
