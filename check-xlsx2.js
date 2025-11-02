import XLSX from 'xlsx';
import { readFileSync } from 'fs';

const fileBuffer = readFileSync('./attached_assets/Itemized_Report_2025_1762108656307.xlsx');
const workbook = XLSX.read(fileBuffer, { type: "buffer" });
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];

// Parse with header row
const dataWithHeader = XLSX.utils.sheet_to_json(sheet, { header: 1 });

console.log('First 3 rows (raw):');
console.log(dataWithHeader.slice(0, 3));

// Parse normally
const data = XLSX.utils.sheet_to_json(sheet);

console.log('\nFirst 2 data objects:');
console.log(data.slice(0, 2));
