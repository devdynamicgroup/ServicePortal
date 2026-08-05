// Centralizes booking-input validation. Consolidates the identical
// "Full Name is required" check that was duplicated in createCase() and
// submitCustomerPreassessment() (services/case-creation-service.js).
// Rule is unchanged: fullName must be a non-empty string after trimming.

function validateCustomerInput(customer) {
  if (!customer?.fullName) {
    const error = new Error('Full Name is required');
    error.statusCode = 400;
    throw error;
  }
}

module.exports = {
  validateCustomerInput
};
