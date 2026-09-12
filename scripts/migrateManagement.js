const mongoose=require('mongoose');
require('dotenv').config();
const {normalizePhone,brandKey}=require('../services/leadValidation');
const apply=process.argv.includes('--apply');
(async()=>{
 if(!process.env.MONGO_URI)throw new Error('MONGO_URI is required');
 await mongoose.connect(process.env.MONGO_URI,{autoIndex:false,autoCreate:false});
 const User=require('../models/User'),Lead=require('../models/Lead'),Group=require('../models/LeadGroup'),Imports=require('../models/LeadImport');
 const users=await User.countDocuments({$or:[{role:'user'},{accountState:{$exists:false}}]});
 let total=0,exceptions=0;const phones=new Set(),brands=new Set();let group;
 if(apply){await User.updateMany({role:'user'},{$set:{role:'calling_agent'}});await User.updateMany({accountState:{$exists:false}},[{$set:{accountState:{$cond:[{$eq:['$isActive',false]},'suspended','active']}}]);const admin=await User.findOne({role:'admin'});if(!admin)throw new Error('An Admin account is required');group=await Group.findOneAndUpdate({normalizedName:'legacy leads'},{$setOnInsert:{name:'Legacy Leads',createdBy:admin._id}},{upsert:true,new:true});}
 let operations=[];
 for await(const lead of Lead.find().sort({createdAt:1,_id:1}).lean().cursor()){
  const brandName=lead.brandName||lead.company||lead.name||'Unknown lead',phoneNormalized=normalizePhone(lead.phone),brandNormalized=brandKey(brandName);
  const duplicate=Boolean((phoneNormalized&&phones.has(phoneNormalized))||brands.has(brandNormalized));if(duplicate)exceptions++;if(phoneNormalized)phones.add(phoneNormalized);brands.add(brandNormalized);total++;
  if(apply){const set={brandName,brandNormalized,phoneNormalized:phoneNormalized||'',version:lead.version||0,assignmentVersion:lead.assignmentVersion||0,...(!lead.group?{group:group._id}:{})};if(phoneNormalized)set.phone=phoneNormalized;
   if(duplicate||lead.duplicateException){set.duplicateException=true;operations.push({updateOne:{filter:{_id:lead._id},update:{$set:set,$unset:{phoneKey:'',brandKey:''}}}})}else{set.brandKey=brandNormalized;if(phoneNormalized)set.phoneKey=phoneNormalized;operations.push({updateOne:{filter:{_id:lead._id},update:{$set:set}}})}
   if(operations.length===500){await Lead.bulkWrite(operations);operations=[];}
  }
 }
 if(apply){if(operations.length)await Lead.bulkWrite(operations);await Imports.updateMany({group:{$exists:false}},{$set:{group:group._id,duplicateRows:0}});await Lead.createIndexes();}
 console.log(JSON.stringify({mode:apply?'applied':'dry-run',accountsToMigrate:users,leads:total,legacyDuplicateExceptions:exceptions}));
 console.log('Legacy records remain intact. Existing duplicates are retained as legacy exceptions.');
})().catch(error=>{console.error(error.message);process.exitCode=1}).finally(()=>mongoose.disconnect());
