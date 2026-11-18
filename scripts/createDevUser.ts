// Local development only: create (or update) an activated admin account with every
// premium feature unlocked, bypassing email activation and Stripe.
//
// Usage: pnpm dev-user <email> <password>

import mongoose from 'mongoose'
import bcrypt from 'bcrypt'
import connectDB from '../api/utils/connectDB'
import Users from '../api/models/User'

(async () => {
  const [email, password] = process.argv.slice(2)

  if (!email || !password) {
    console.error('Usage: pnpm dev-user <email> <password>')

    process.exit(1)
  }

  connectDB()

  const user = await Users.findOneAndUpdate(
    { email },
    {
      email,
      password: await bcrypt.hash(password, 10),
      activated: true,
      admin: true,
      // Premium: level 2 is the highest tier offered by SubscriptionForm
      hasActiveSubscription: true,
      subscriptionLevel: 2,
      // Each watch check spends 1 point (scripts/checkWatches.ts)
      watchPoints: 1_000_000,
      watchPointsSubscription: true
    },
    { upsert: true, new: true }
  )

  console.log(`Dev user ready: ${user.email} (admin, premium level 2, ${user.watchPoints} watch points)`)

  await mongoose.disconnect()
})()
