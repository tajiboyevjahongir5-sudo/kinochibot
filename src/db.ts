import mongoose from 'mongoose';

export const connectDB = async () => {
  try {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URL || process.env.MONGO_URI;
    if (!uri) {
      throw new Error('MONGODB_URI or MONGO_URL is not defined in environment variables.');
    }
    await mongoose.connect(uri);
    console.log('✅ Connected to MongoDB successfully.');
  } catch (error) {
    console.error('❌ Failed to connect to MongoDB:', error);
    process.exit(1);
  }
};
