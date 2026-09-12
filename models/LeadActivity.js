const mongoose=require('mongoose');
const schema=new mongoose.Schema({lead:{type:mongoose.Schema.Types.ObjectId,ref:'Lead',required:true},actor:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true},type:{type:String,enum:['uploaded','assigned','reassigned','updated','call','duplicate-approved'],required:true},operationId:String,details:mongoose.Schema.Types.Mixed},{timestamps:true});
schema.index({lead:1,createdAt:-1});schema.index({actor:1,operationId:1},{unique:true,partialFilterExpression:{operationId:{$type:'string'}}});
module.exports=mongoose.model('LeadActivity',schema);
