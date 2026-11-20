import {FamilyLedgerApp2D} from './app2d.ts';

document.addEventListener('DOMContentLoaded', () => {
  const root = document.getElementById('root');
  if (root) {
    new FamilyLedgerApp2D(root);
  }
});
