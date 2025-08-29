import { 
  MEDICAL_RECORD_LABELS, 
  DOCUMENT_TYPE_LABELS,
  APPOINTMENT_STATUS_LABELS,
  ACCESS_PERMISSION_LABELS,
  PAYMENT_STATUS 
} from './constants';

export const formatDate = (date, options = {}) => {
  if (!date) return '';
  
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  
  if (isNaN(dateObj.getTime())) return '';
  
  const defaultOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  };
  
  const formatOptions = { ...defaultOptions, ...options };
  
  try {
    return dateObj.toLocaleDateString('en-US', formatOptions);
  } catch (error) {
    console.error('Date formatting error:', error);
    return dateObj.toLocaleDateString();
  }
};

export const formatDateTime = (date, options = {}) => {
  if (!date) return '';
  
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  
  if (isNaN(dateObj.getTime())) return '';
  
  const defaultOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  };
  
  const formatOptions = { ...defaultOptions, ...options };
  
  try {
    return dateObj.toLocaleString('en-US', formatOptions);
  } catch (error) {
    console.error('DateTime formatting error:', error);
    return dateObj.toLocaleString();
  }
};

export const formatTime = (date, use24Hour = false) => {
  if (!date) return '';
  
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  
  if (isNaN(dateObj.getTime())) return '';
  
  const options = {
    hour: '2-digit',
    minute: '2-digit',
    hour12: !use24Hour
  };
  
  try {
    return dateObj.toLocaleTimeString('en-US', options);
  } catch (error) {
    console.error('Time formatting error:', error);
    return dateObj.toLocaleTimeString();
  }
};

export const formatRelativeTime = (date) => {
  if (!date) return '';
  
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  
  if (isNaN(dateObj.getTime())) return '';
  
  const now = new Date();
  const diffInSeconds = Math.floor((now - dateObj) / 1000);
  
  if (diffInSeconds < 60) {
    return 'Just now';
  }
  
  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) {
    return `${diffInMinutes} minute${diffInMinutes > 1 ? 's' : ''} ago`;
  }
  
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) {
    return `${diffInHours} hour${diffInHours > 1 ? 's' : ''} ago`;
  }
  
  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays < 30) {
    return `${diffInDays} day${diffInDays > 1 ? 's' : ''} ago`;
  }
  
  const diffInMonths = Math.floor(diffInDays / 30);
  if (diffInMonths < 12) {
    return `${diffInMonths} month${diffInMonths > 1 ? 's' : ''} ago`;
  }
  
  const diffInYears = Math.floor(diffInMonths / 12);
  return `${diffInYears} year${diffInYears > 1 ? 's' : ''} ago`;
};

export const formatCurrency = (amount, currency = 'USD', options = {}) => {
  if (amount === null || amount === undefined) return '';
  
  const numericAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
  
  if (isNaN(numericAmount)) return '';
  
  const defaultOptions = {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  };
  
  const formatOptions = { ...defaultOptions, ...options };
  
  try {
    return new Intl.NumberFormat('en-US', formatOptions).format(numericAmount);
  } catch (error) {
    console.error('Currency formatting error:', error);
    return `${currency} ${numericAmount.toFixed(2)}`;
  }
};

export const formatCrypto = (amount, symbol = 'BTC', decimals = 8) => {
  if (amount === null || amount === undefined) return '';
  
  const numericAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
  
  if (isNaN(numericAmount)) return '';
  
  const formatted = numericAmount.toFixed(decimals);
  const trimmed = formatted.replace(/\.?0+$/, '');
  
  return `${trimmed} ${symbol}`;
};

export const formatEther = (wei, decimals = 4) => {
  if (!wei) return '0 ETH';
  
  try {
    const ether = parseFloat(wei) / Math.pow(10, 18);
    return `${ether.toFixed(decimals)} ETH`;
  } catch (error) {
    console.error('Ether formatting error:', error);
    return '0 ETH';
  }
};

export const formatGwei = (wei, decimals = 2) => {
  if (!wei) return '0 Gwei';
  
  try {
    const gwei = parseFloat(wei) / Math.pow(10, 9);
    return `${gwei.toFixed(decimals)} Gwei`;
  } catch (error) {
    console.error('Gwei formatting error:', error);
    return '0 Gwei';
  }
};

export const formatNumber = (number, options = {}) => {
  if (number === null || number === undefined) return '';
  
  const numericValue = typeof number === 'string' ? parseFloat(number) : number;
  
  if (isNaN(numericValue)) return '';
  
  const defaultOptions = {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0
  };
  
  const formatOptions = { ...defaultOptions, ...options };
  
  try {
    return new Intl.NumberFormat('en-US', formatOptions).format(numericValue);
  } catch (error) {
    console.error('Number formatting error:', error);
    return numericValue.toString();
  }
};

export const formatPercentage = (value, decimals = 1) => {
  if (value === null || value === undefined) return '';
  
  const numericValue = typeof value === 'string' ? parseFloat(value) : value;
  
  if (isNaN(numericValue)) return '';
  
  return `${numericValue.toFixed(decimals)}%`;
};

export const formatFileSize = (bytes, decimals = 2) => {
  if (bytes === 0) return '0 Bytes';
  if (!bytes) return '';
  
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
};

export const formatAddress = (address, startChars = 6, endChars = 4) => {
  if (!address) return '';
  
  if (address.length <= startChars + endChars) return address;
  
  return `${address.slice(0, startChars)}...${address.slice(-endChars)}`;
};

export const formatTransactionHash = (hash, chars = 10) => {
  return formatAddress(hash, chars, 4);
};

export const formatDuration = (milliseconds) => {
  if (!milliseconds || milliseconds < 0) return '';
  
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
};

export const formatAge = (birthDate) => {
  if (!birthDate) return '';
  
  const birth = typeof birthDate === 'string' ? new Date(birthDate) : birthDate;
  
  if (isNaN(birth.getTime())) return '';
  
  const now = new Date();
  const age = Math.floor((now - birth) / (365.25 * 24 * 60 * 60 * 1000));
  
  return `${age} years old`;
};

export const formatPhoneNumber = (phoneNumber, format = 'US') => {
  if (!phoneNumber) return '';
  
  const cleaned = phoneNumber.replace(/\D/g, '');
  
  if (format === 'US' && cleaned.length === 10) {
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  } else if (format === 'US' && cleaned.length === 11 && cleaned[0] === '1') {
    return `+1 (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
  }
  
  return phoneNumber;
};

export const formatMedicalRecordType = (type) => {
  return MEDICAL_RECORD_LABELS[type] || type;
};

export const formatDocumentType = (type) => {
  return DOCUMENT_TYPE_LABELS[type] || type;
};

export const formatAppointmentStatus = (status) => {
  return APPOINTMENT_STATUS_LABELS[status] || status;
};

export const formatAccessPermission = (permission) => {
  return ACCESS_PERMISSION_LABELS[permission] || permission;
};

export const formatPermissionsList = (permissions) => {
  if (!permissions || !Array.isArray(permissions)) return '';
  
  return permissions
    .map(permission => formatAccessPermission(permission))
    .join(', ');
};

export const formatBloodPressure = (systolic, diastolic) => {
  if (!systolic || !diastolic) return '';
  return `${systolic}/${diastolic} mmHg`;
};

export const formatTemperature = (temp, unit = 'F') => {
  if (temp === null || temp === undefined) return '';
  return `${temp}°${unit}`;
};

export const formatWeight = (weight, unit = 'lbs') => {
  if (weight === null || weight === undefined) return '';
  return `${weight} ${unit}`;
};

export const formatHeight = (height, unit = 'inches') => {
  if (height === null || height === undefined) return '';
  
  if (unit === 'inches') {
    const feet = Math.floor(height / 12);
    const inches = height % 12;
    return `${feet}'${inches}"`;
  }
  
  return `${height} ${unit}`;
};

export const formatBMI = (bmi) => {
  if (bmi === null || bmi === undefined) return '';
  
  const category = getBMICategory(bmi);
  return `${bmi.toFixed(1)} (${category})`;
};

export const getBMICategory = (bmi) => {
  if (bmi < 18.5) return 'Underweight';
  if (bmi < 25) return 'Normal';
  if (bmi < 30) return 'Overweight';
  return 'Obese';
};

export const formatDosage = (amount, unit, frequency) => {
  if (!amount || !unit) return '';
  
  let formatted = `${amount} ${unit}`;
  
  if (frequency) {
    formatted += ` ${frequency}`;
  }
  
  return formatted;
};

export const formatSearchQuery = (query) => {
  if (!query) return '';
  
  return query
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
};

export const formatError = (error) => {
  if (typeof error === 'string') return error;
  
  if (error?.response?.data?.message) return error.response.data.message;
  if (error?.message) return error.message;
  
  return 'An unexpected error occurred';
};

export const formatValidationErrors = (errors) => {
  if (!errors || typeof errors !== 'object') return [];
  
  if (Array.isArray(errors)) {
    return errors.map(error => ({
      field: error.field || '',
      message: error.message || error.msg || error
    }));
  }
  
  return Object.entries(errors).map(([field, message]) => ({
    field,
    message: Array.isArray(message) ? message[0] : message
  }));
};

export const formatPaginationInfo = (page, limit, total) => {
  if (!total || total === 0) return 'No items found';
  
  const start = (page - 1) * limit + 1;
  const end = Math.min(page * limit, total);
  
  return `Showing ${start}-${end} of ${total} items`;
};

export const formatLoadingText = (operation) => {
  const operations = {
    'loading': 'Loading...',
    'saving': 'Saving...',
    'deleting': 'Deleting...',
    'uploading': 'Uploading...',
    'processing': 'Processing...',
    'connecting': 'Connecting...',
    'verifying': 'Verifying...',
    'sending': 'Sending...',
    'fetching': 'Fetching...'
  };
  
  return operations[operation] || `${operation}...`;
};

export const formatApiEndpoint = (endpoint, params = {}) => {
  let formattedEndpoint = endpoint;
  
  Object.entries(params).forEach(([key, value]) => {
    formattedEndpoint = formattedEndpoint.replace(`:${key}`, value);
  });
  
  return formattedEndpoint;
};

export const formatNotificationText = (type, data) => {
  const templates = {
    'appointment_reminder': `Appointment with Dr. ${data.doctorName} tomorrow at ${formatTime(data.appointmentTime)}`,
    'record_updated': `Your ${formatMedicalRecordType(data.recordType)} has been updated`,
    'access_granted': `Access granted to Dr. ${data.doctorName}`,
    'access_revoked': `Access revoked from Dr. ${data.doctorName}`,
    'payment_received': `Payment of ${formatCrypto(data.amount, data.currency)} received`,
    'document_shared': `Document "${data.documentName}" has been shared`,
    'security_alert': 'Security alert: Unusual login activity detected'
  };
  
  return templates[type] || 'Notification';
};

export const formatChartData = (data, xKey, yKey, formatter = null) => {
  if (!Array.isArray(data)) return [];
  
  return data.map(item => ({
    x: item[xKey],
    y: formatter ? formatter(item[yKey]) : item[yKey],
    ...item
  }));
};

export const formatTooltip = (value, label, unit = '') => {
  return `${label}: ${formatNumber(value)} ${unit}`;
};

export const formatTableCell = (value, type = 'text') => {
  switch (type) {
    case 'date':
      return formatDate(value);
    case 'datetime':
      return formatDateTime(value);
    case 'currency':
      return formatCurrency(value);
    case 'number':
      return formatNumber(value);
    case 'percentage':
      return formatPercentage(value);
    case 'address':
      return formatAddress(value);
    case 'filesize':
      return formatFileSize(value);
    default:
      return value || '';
  }
};

export const formatSelectOption = (value, label) => ({
  value,
  label: label || value
});

export const formatSelectOptions = (items, valueKey = 'value', labelKey = 'label') => {
  if (!Array.isArray(items)) return [];
  
  return items.map(item => {
    if (typeof item === 'string') {
      return formatSelectOption(item, item);
    }
    
    return formatSelectOption(item[valueKey], item[labelKey]);
  });
};

export const capitalize = (str) => {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
};

export const capitalizeWords = (str) => {
  if (!str) return '';
  return str
    .split(' ')
    .map(word => capitalize(word))
    .join(' ');
};

export const truncate = (str, maxLength = 100, suffix = '...') => {
  if (!str) return '';
  
  if (str.length <= maxLength) return str;
  
  return str.slice(0, maxLength - suffix.length) + suffix;
};

export const slugify = (str) => {
  if (!str) return '';
  
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

export const formatPlural = (count, singular, plural) => {
  const word = count === 1 ? singular : (plural || `${singular}s`);
  return `${count} ${word}`;
};

export const formatBooleanText = (value, trueText = 'Yes', falseText = 'No') => {
  return value ? trueText : falseText;
};

export const formatColorFromString = (str) => {
  if (!str) return '#000000';
  
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  const color = Math.abs(hash).toString(16).substring(0, 6);
  return `#${'000000'.substring(0, 6 - color.length) + color}`;
};

export default {
  formatDate,
  formatDateTime,
  formatTime,
  formatRelativeTime,
  formatCurrency,
  formatCrypto,
  formatEther,
  formatGwei,
  formatNumber,
  formatPercentage,
  formatFileSize,
  formatAddress,
  formatTransactionHash,
  formatDuration,
  formatAge,
  formatPhoneNumber,
  formatMedicalRecordType,
  formatDocumentType,
  formatAppointmentStatus,
  formatAccessPermission,
  formatPermissionsList,
  formatBloodPressure,
  formatTemperature,
  formatWeight,
  formatHeight,
  formatBMI,
  getBMICategory,
  formatDosage,
  formatSearchQuery,
  formatError,
  formatValidationErrors,
  formatPaginationInfo,
  formatLoadingText,
  formatApiEndpoint,
  formatNotificationText,
  formatChartData,
  formatTooltip,
  formatTableCell,
  formatSelectOption,
  formatSelectOptions,
  capitalize,
  capitalizeWords,
  truncate,
  slugify,
  formatPlural,
  formatBooleanText,
  formatColorFromString
};