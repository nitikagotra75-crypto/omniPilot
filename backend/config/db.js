import mongoose from "mongoose";

export async function connectDb(uri, { timeoutMs = 8000 } = {}) {
  mongoose.set("strictQuery", true);
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: timeoutMs });
  } catch (e) {
    const err = new Error(
      `Cannot reach MongoDB at ${redact(uri)}. Start MongoDB locally, or set MONGODB_URI (for example to a MongoDB Atlas connection string). (${e.message})`
    );
    err.code = "MONGO_UNREACHABLE";
    throw err;
  }
  return mongoose.connection;
}

export const redact = (uri) => uri.replace(/\/\/([^:@/]+):([^@/]+)@/, "//$1:***@");
export const dbConnected = () => mongoose.connection.readyState === 1;
