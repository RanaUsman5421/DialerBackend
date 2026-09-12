const fields = [
  ['brandName','Brand Name*',true], ['phone','Phone No*',true], ['email','Email',false],
  ['leadType','Lead Type*',true], ['perDayOrders','Per day Orders*',true],
  ['extractedFrom','Lead Extrat  From*',true], ['extractedBy','Lead Extract by*',true],
  ['followers','Followers*',true], ['socialActivity','Social Activity*',true],
  ['matureConfidence','Mature Confidence*',true], ['productDetails','Product Details*',true],
  ['websiteUrl','Website URL',false], ['socialLink','Any Social Link*',true],
];
const key = value => String(value ?? '').normalize('NFKC').trim().toLowerCase().replace(/[^a-z0-9]/g,'');
const brandKey = value => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
function normalizePhone(value) {
  let phone=String(value ?? '').trim().replace(/^'+/,'').replace(/[\s().-]/g,'');
  if (phone.startsWith('0092')) phone='+92'+phone.slice(4);
  else if (phone.startsWith('92')) phone='+'+phone;
  else if (phone.startsWith('0')) phone='+92'+phone.slice(1);
  else if (/^[1-9]\d{9}$/.test(phone)) phone='+92'+phone;
  return /^\+92[1-9]\d{9}$/.test(phone) ? phone : null;
}
function mapRow(row) {
  const entries=new Map(Object.entries(row).map(([header,value])=>[key(header),value]));
  return Object.fromEntries(fields.map(([name,header])=>[name, entries.get(key(name)) ?? entries.get(key(header)) ?? '']));
}
function validateRow(row) {
  const raw=mapRow(row), data={}, errors=[];
  for (const [name,label,required] of fields) {
    const value=String(raw[name] ?? '').trim();
    if(required && !value) errors.push(`${label.replace('*','').trim()} is required`);
    if(value.length>2000) errors.push(`${label.replace('*','').trim()} exceeds 2000 characters`);
    data[name]=value.slice(0,2000);
  }
  const normalized=normalizePhone(data.phone);
  if(data.phone && !normalized) errors.push('Phone No must be a valid Pakistani number');
  if(normalized) data.phone=normalized;
  if(data.matureConfidence) {
    const value=Number(data.matureConfidence.replace(/%$/,''));
    if(!Number.isFinite(value) || value<0 || value>100) errors.push('Mature Confidence must be between 0% and 100%');
    else data.matureConfidence=value;
  }
  data.phoneNormalized=normalized || '';
  data.brandNormalized=brandKey(data.brandName);
  data.name=data.brandName; data.company=data.brandName;
  return {raw,data,errors};
}
module.exports={fields,key,brandKey,normalizePhone,mapRow,validateRow};
