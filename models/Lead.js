const mongoose=require('mongoose');
const ref={type:mongoose.Schema.Types.ObjectId,ref:'User'};
const schema=new mongoose.Schema({
 name:{type:String,default:'Unknown lead'},company:String,brandName:{type:String,required:true},phone:{type:String,required:true},
 phoneNormalized:{type:String,index:true},brandNormalized:{type:String,index:true},phoneKey:String,brandKey:String,
 email:String,leadType:String,perDayOrders:String,extractedFrom:String,extractedBy:String,followers:String,socialActivity:String,
 matureConfidence:{type:Number,min:0,max:100},productDetails:String,websiteUrl:String,socialLink:String,
 city:{type:String,default:''},source:String,notes:{type:String,default:''},
 status:{type:String,enum:['new','contacted','qualified','won','lost'],default:'new'},callStatus:String,leadCategory:String,activity:String,
 lastCallOutcome:String,lastCallDirection:{type:String,enum:['OUTGOING','INCOMING']},lastCallDuration:Number,followUpAt:Date,assignedTo:{...ref,default:null},uploadedBy:{...ref,required:true},uploadedAt:{type:Date,default:Date.now},assignedBy:ref,assignedAt:Date,
 group:{type:mongoose.Schema.Types.ObjectId,ref:'LeadGroup'},importBatch:{type:mongoose.Schema.Types.ObjectId,ref:'LeadImport'},sourceRow:Number,
 version:{type:Number,default:0},assignmentVersion:{type:Number,default:0},duplicateException:{type:Boolean,default:false},
 extra:{type:Map,of:String,default:{}}
},{timestamps:true});
schema.index({phoneKey:1},{unique:true,sparse:true});schema.index({brandKey:1},{unique:true,sparse:true});
schema.index({assignedTo:1,status:1,createdAt:-1});schema.index({uploadedBy:1,group:1,createdAt:-1});schema.index({group:1,assignedTo:1});schema.index({assignedTo:1,followUpAt:1});schema.index({followUpAt:1});schema.index({uploadedAt:1});
module.exports=mongoose.model('Lead',schema);
