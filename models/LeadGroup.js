const mongoose=require('mongoose');
const schema=new mongoose.Schema({name:{type:String,required:true,maxlength:120},normalizedName:{type:String,required:true,unique:true},createdBy:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true}},{timestamps:true});
module.exports=mongoose.model('LeadGroup',schema);
