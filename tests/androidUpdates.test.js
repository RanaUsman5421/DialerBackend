const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validate}=require('../routes/androidUpdates');
const valid={applicationId:'com.example.lionexphone',versionCode:3,versionName:'1.2',apkUrl:'https://github.com/company/app/releases/download/android-v1.2/app.apk',sha256:'a'.repeat(64),sizeBytes:100,notes:'Test'};
test('disabled release is intentional no update',()=>assert.equal(validate({enabled:false}),null));
test('valid public APK release metadata',()=>assert.equal(validate(valid).versionCode,3));
test('invalid releases fail closed',()=>{
  for(const change of [{apkUrl:'http://github.com/company/app/releases/download/tag/app.apk'},{apkUrl:'https://evil.com/app.apk'},{apkUrl:'https://github.com/company/app/releases/tag/tag'},{sha256:'bad'},{versionCode:0},{sizeBytes:300000000},{applicationId:'other'}]) assert.throws(()=>validate({...valid,...change}));
});
