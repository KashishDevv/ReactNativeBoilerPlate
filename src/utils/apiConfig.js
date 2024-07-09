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
