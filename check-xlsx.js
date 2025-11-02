import XLSX from 'xlsx';
import { readFileSync } from 'fs';

const fileBuffer = readFileSync('./attached_assets/Itemized_Report_2025_1762108656307.xlsx');
const workbook = XLSX.read(fileBuffer, { type: "buffer" });
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];
const data = XLSX.utils.sheet_to_json(sheet);

console.log('Sheet name:', sheetName);
console.log('Total rows:', data.length);
console.log('\nFirst row (to see column names):');
console.log(JSON.stringify(data[0], null, 2));
console.log('\nAll column names:');
console.log(Object.keys(data[0]));
