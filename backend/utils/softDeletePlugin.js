const mongoose = require('mongoose');

module.exports = function softDeletePlugin(schema) {
  schema.add({
    isDeleted: {
            type: Boolean,
            default: false,
            index: true
    },
    deletedAt: {
            type: Date,
            default: null
    }
  });

  // Pre-query middleware to exclude deleted documents
  const excludeDeletedMiddleware = async function() {
    const options = this.getOptions ? this.getOptions() : {};
    if (options.withDeleted) {
      return;
    }
    this.where({ isDeleted: { $ne: true } });
  };

  schema.pre('find', excludeDeletedMiddleware);
  schema.pre('findOne', excludeDeletedMiddleware);
  schema.pre('findOneAndUpdate', excludeDeletedMiddleware);
  schema.pre('update', excludeDeletedMiddleware);
  schema.pre('updateOne', excludeDeletedMiddleware);
  schema.pre('updateMany', excludeDeletedMiddleware);
  schema.pre('countDocuments', excludeDeletedMiddleware);
  
  schema.pre('aggregate', async function() {
    const options = this.options || {}; // Aggregation query options
    if (options.withDeleted) {
      return;
    }
    this.pipeline().unshift({ $match: { isDeleted: { $ne: true } } });
  });

  // Soft delete method
  schema.methods.softDelete = async function() {
    this.isDeleted = true;
    this.deletedAt = new Date();
    return this.save();
  };

  // Restore method
  schema.methods.restore = async function() {
    this.isDeleted = false;
    this.deletedAt = null;
    return this.save();
  };
};
