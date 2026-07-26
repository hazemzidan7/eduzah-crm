# Eduzah CRM

Standalone CRM product, split out of the Eduzah Platform (`feature/crm-v2-catalog`, commit `28d9f37`).
Customer/Engagement model, Business Unit catalog, hybrid lead statuses, and the Smart Import Engine — unchanged from the original.

## Setup

```
npm install
cp .env.example .env   # already points at the eduzah-crm Firebase project
npm run dev
```

## First admin account

See `SETUP_ADMIN.txt`. In short: deploy Firestore rules, create a `settings/bootstrap` doc with `enabled: true`,
visit `/setup-admin` to create the first admin, then delete that doc.

## Deploying Firestore rules

```
npm run deploy:rules
```
