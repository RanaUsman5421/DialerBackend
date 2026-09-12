const User = require('../models/User');
const Lead = require('../models/Lead');
const Activity = require('../models/LeadActivity');
const Calls = require('../models/CallAttempt');
const Rejected = require('../models/RejectedLead');
const {publicUser} = require('./auth');
const mapById = rows => new Map(rows.map(row=>[String(row._id),row]));
async function teamPerformance(req,res) {
  const page=Math.max(1,Math.min(10000,parseInt(req.query.page)||1));
  const limit=12,filter={role:{$in:['admin','leads_agent','calling_agent','user']}};
  if(req.query.role){if(!['admin','leads_agent','calling_agent'].includes(req.query.role))return res.status(400).json({error:'Invalid account role'});filter.role=req.query.role==='calling_agent'?{$in:['calling_agent','user']}:req.query.role;}
  if(req.query.q){const q=String(req.query.q).slice(0,100).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');filter.$or=['name','username','email'].map(field=>({[field]:{$regex:q,$options:'i'}}));}
  const [users,total]=await Promise.all([User.find(filter).select('name username email role isActive accountState createdAt updatedAt').sort({name:1,_id:1}).skip((page-1)*limit).limit(limit).lean(),User.countDocuments(filter)]);
  const ids=users.map(user=>user._id),now=new Date();
  const [assignedRows,uploadedRows,relatedRows,rejectedRows,callRows,byRows,toRows]=await Promise.all([
    Lead.aggregate([{$match:{assignedTo:{$in:ids}}},{$group:{_id:'$assignedTo',assigned:{$sum:1},pending:{$sum:{$cond:[{$in:['$status',['won','lost']]},0,1]}},worked:{$sum:{$cond:[{$in:['$status',['contacted','qualified','won','lost']]},1,0]}},closed:{$sum:{$cond:[{$eq:['$status','won']},1,0]}},dead:{$sum:{$cond:[{$eq:['$status','lost']},1,0]}},overdue:{$sum:{$cond:[{$and:[{$ne:[{$ifNull:['$followUpAt',null]},null]},{$lt:['$followUpAt',now]},{$not:[{$in:['$status',['won','lost']]}]}]},1,0]}},groups:{$addToSet:'$group'}}}]),
    Lead.aggregate([{$match:{uploadedBy:{$in:ids}}},{$group:{_id:'$uploadedBy',uploaded:{$sum:1}}}]),
    Lead.aggregate([{$match:{$or:[{assignedTo:{$in:ids}},{uploadedBy:{$in:ids}}]}},{$project:{owners:{$setUnion:[['$uploadedBy'],['$assignedTo']]}}},{$unwind:'$owners'},{$match:{owners:{$in:ids}}},{$group:{_id:'$owners',totalLeads:{$sum:1}}}]),
    Rejected.aggregate([{$match:{uploadedBy:{$in:ids},state:'rejected'}},{$group:{_id:'$uploadedBy',rejected:{$sum:1}}}]),
    Calls.aggregate([{$match:{actor:{$in:ids}}},{$group:{_id:'$actor',callAttempts:{$sum:1}}}]),
    Activity.aggregate([{$match:{actor:{$in:ids},type:{$in:['assigned','reassigned']}}},{$group:{_id:'$actor',leads:{$addToSet:'$lead'}}}]),
    Activity.aggregate([{$match:{'details.newAgent':{$in:[...ids,...ids.map(String)]},type:{$in:['assigned','reassigned']}}},{$group:{_id:{$convert:{input:'$details.newAgent',to:'objectId',onError:null,onNull:null}},leads:{$addToSet:'$lead'}}}]),
  ]);
  const [assigned,uploaded,related,rejected,calls,by,to]=[assignedRows,uploadedRows,relatedRows,rejectedRows,callRows,byRows,toRows].map(mapById);
  res.json({users:users.map(user=>{const id=String(user._id),a=assigned.get(id)||{};return {...publicUser(user),createdAt:user.createdAt,updatedAt:user.updatedAt,metrics:{totalLeads:related.get(id)?.totalLeads||0,assigned:a.assigned||0,uploaded:uploaded.get(id)?.uploaded||0,pending:a.pending||0,worked:a.worked||0,closed:a.closed||0,dead:a.dead||0,overdue:a.overdue||0,assignedGroups:(a.groups||[]).filter(Boolean).length,rejected:rejected.get(id)?.rejected||0,callAttempts:calls.get(id)?.callAttempts||0,assignedByThem:by.get(id)?.leads.length||0,assignedToThem:to.get(id)?.leads.length||0}};}),pagination:{page,limit,total,pages:Math.max(1,Math.ceil(total/limit))}});
}
module.exports={teamPerformance};
