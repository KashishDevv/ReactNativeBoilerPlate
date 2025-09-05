// Importing necessary headers from axiosConfig file
import API from "./ConfigAxios";


// Function to make a raw data API request
export const rawDataGetAPIAxios = async () => {
    try {
        // Making a GET request to the specified API URL with the payload and regular header
        const response = await API.get('/1')
        // Extracting data from the response
        const data = response.data;
        // Returning the data
        return data;
    } catch (error) {
        // If an error occurs, catching it and returning the error
        console.log(error, "error")
        return error;
    }
}

// Function to make a raw data API request
export const rawDataPostAPIAxios = async () => {
    try {
        // Making a POST request to the specified API URL with the payload and regular header
        const response = await API.post('/add', { "title": 'BMW Pencil' }, {
            // headers :{Authorization}  // {You can pass the addition Header here like Authorization }
        })
        // Extracting data from the response
        const data = response.data;
        // Returning the data
        return data;
    } catch (error) {
        // If an error occurs, catching it and returning the error
        console.log(error, "error")
        return error;
    }
}

// Function to post pet health BLE data to server after successful connection
export const postPetHealthBLEData = async (petHealthData) => {
    try {
        console.log('📤 Sending pet health BLE data to server:', petHealthData);
        
        // Making a POST request to the Pet/PetHealthBLEDetail endpoint
        const response = await API.post('/Pet/PetHealthBLEDetail', petHealthData, {
            headers: {
                'Content-Type': 'application/json',
                'APiKey': '34A4601F-0930-4A22-8993-97B951881F83',
                'Password': 'xxxaeexrkp'
            }
        });
        
        // Log the successful response
        console.log('✅ Pet health BLE data sent successfully:', response.data);
        
        // Return the response data
        return response.data;
    } catch (error) {
        // Log the error details
        console.error('❌ Failed to send pet health BLE data:', error);
        console.error('Response status:', error.response.status);
        console.error('Response data:', error.response.data);
        return { success: false, error: error.message };
    }
}

// Function to get pet health BLE details from server
export const getPetHealthBLEDetails = async (petId = 1059773) => {
  try {
    console.log('📥 Fetching pet health BLE details from server for Pet ID:', petId);
    const response = await API.get(`Pet/PetHealthBLEDetails?PetId=${petId}`, {
      headers: {
        "APiKey": "34A4601F-0930-4A22-8993-97B951881F83",
        "Password": "xxxaeexrkp"
      }
    });
    console.log('✅ Pet health BLE details fetched successfully:', response.data);
    return response.data;
  } catch (error) {
    console.error('❌ Failed to fetch pet health BLE details:', error);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    return { success: false, error: error.message };
  }
}
