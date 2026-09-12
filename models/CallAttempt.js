const mongoose=require('mongoose');
const schema=new mongoose.Schema({lead:{type:mongoose.Schema.Types.ObjectId,ref:'Lead',default:null},actor:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true},phone:String,operationId:{type:String,required:true},outcome:{type:String,required:true},endedAt:Date,duration:Number,remark:String},{timestamps:true});
schema.index({actor:1,operationId:1},{unique:true});schema.index({lead:1,createdAt:-1});module.exports=mongoose.model('CallAttempt',schema);
