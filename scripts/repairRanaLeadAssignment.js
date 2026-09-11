require('dotenv').config()
const mongoose = require('mongoose')
const Lead = require('../models/Lead')
const LeadImport = require('../models/LeadImport')
const User = require('../models/User')

async function run() {
  await mongoose.connect(process.env.MONGO_URI)
  const target = await User.findOne({ email: 'macktech28@gmail.com', role: 'user' })
  const source = await User.findOne({ email: 'rana.usman.test@lionex.com', role: 'user' })
  if (!target) throw new Error('Target user macktech28@gmail.com was not found')
  if (!source) throw new Error('Source test user was not found')

  const leadResult = await Lead.updateMany({ assignedTo: source._id }, { $set: { assignedTo: target._id } })
  const importResult = await LeadImport.updateMany({ assignedTo: source._id }, { $set: { assignedTo: target._id } })
  console.log(JSON.stringify({
    targetUserId: target._id.toString(),
    sourceUserId: source._id.toString(),
    leadsUpdated: leadResult.modifiedCount,
    importsUpdated: importResult.modifiedCount,
  }))
  await mongoose.disconnect()
}

run().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
