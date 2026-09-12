const {MongoMemoryReplSet}=require('mongodb-memory-server');
const mongoose=require('mongoose');
(async()=>{
 const repl=await MongoMemoryReplSet.create({binary:{version:'8.2.6',systemBinary:require('path').resolve('.test-mongodb/mongod.exe')},replSet:{count:1}});
 process.env.JWT_SECRET='local-preview-only-secret';process.env.CLIENT_ORIGIN='*';
 const {server,io}=require('../server');await mongoose.connect(repl.getUri());
 const User=require('../models/User'),Lead=require('../models/Lead'),Group=require('../models/LeadGroup'),Rejected=require('../models/RejectedLead');
 await Promise.all([User,Lead,Group,Rejected,require('../models/LeadActivity'),require('../models/LeadImport'),require('../models/CallAttempt')].map(model=>model.init()));
 const password=await require('bcryptjs').hash('local-preview-123',4),users={};
 for(const [name,role,email] of [['Preview Admin','admin','admin@example.test'],['Preview Leads Agent','leads_agent','leads@example.test'],['Preview Caller','calling_agent','caller@example.test']])users[role]=await User.create({name,role,email,password});
 const group=await Group.create({name:'2027 Campaign',normalizedName:'2027 campaign',createdBy:users.leads_agent._id});
 const raw={brandName:'Preview Brand',phone:'3054447156',leadType:'Premium',perDayOrders:'15',extractedFrom:'TikTok',extractedBy:'Manual',followers:'22k',socialActivity:'Active',matureConfidence:50,productDetails:'Glass items',socialLink:'https://example.test/social'};
 const data=require('../services/leadValidation').validateRow(raw).data;
 await Lead.create({...data,group:group._id,uploadedBy:users.leads_agent._id,phoneKey:data.phoneNormalized,brandKey:data.brandNormalized,assignedTo:users.calling_agent._id});
 await Rejected.create({raw:{...raw,brandName:'Rejected Brand',phone:'3055555555',socialLink:''},errors:['Any Social Link is required'],reason:'validation',group:group._id,uploadedBy:users.leads_agent._id});
 server.listen(3038,'127.0.0.1',()=>console.log('Disposable preview backend: http://127.0.0.1:3038 | accounts admin@example.test, leads@example.test, caller@example.test | password local-preview-123'));
 const close=async()=>{await new Promise(resolve=>io.close(resolve));await mongoose.disconnect();await repl.stop();process.exit(0)};process.on('SIGINT',close);process.on('SIGTERM',close);
})().catch(error=>{console.error(error);process.exitCode=1});
