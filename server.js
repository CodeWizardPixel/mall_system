const express = require('express');
const { Pool } = require('pg');
const app = express();
const PORT = 8080;


const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'mall_db',
    password: '1',
    port: 5432,
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));


app.get('/api/rooms', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM rooms ORDER BY id ASC');
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/rooms', async (req, res) => {
    try {
        const { floor, area, type, rent_cost, status } = req.body;
        const result = await pool.query(
            'INSERT INTO rooms (floor, area, type, rent_cost, status) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [floor, area, type, rent_cost, status]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});


app.put('/api/rooms/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { floor, area, type, rent_cost } = req.body;
        const result = await pool.query(
            'UPDATE rooms SET floor = $1, area = $2, type = $3, rent_cost = $4 WHERE id = $5 RETURNING *',
            [floor, area, type, rent_cost, id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Room not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});


app.delete('/api/rooms/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM rooms WHERE id = $1 RETURNING *', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Room not found' });
        }
        res.json({ message: 'Room deleted successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }   
});


app.get('/api/rental-requests', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT requests.*, 
                   renters.name as renter_name, 
                   renters.contact_details, 
                   renters.phone, 
                   renters.email, 
                   renters.tax_id,
                   rooms.floor as room_floor,
                   rooms.area as room_area,
                   rooms.type as room_type,
                   rooms.rent_cost
            FROM requests
            JOIN renters ON requests.renter_id = renters.id
            JOIN rooms ON requests.room_id = rooms.id
            ORDER BY requests.application_date DESC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/rental-requests', async (req, res) => {
    const client = await pool.connect();
    try {

        const { name, contact_details, phone, email, tax_id, room_id } = req.body;

        const renterResult = await client.query(
            'INSERT INTO renters (name, contact_details, phone, email, tax_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [name, contact_details, phone, email, tax_id]
        );

        const renter_id = renterResult.rows[0].id;

        const requestResult = await client.query(
            'INSERT INTO requests (renter_id, room_id, status) VALUES ($1, $2, $3) RETURNING *',
            [renter_id, room_id, 'pending']
        );

        res.json(requestResult.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.put('/api/rental-requests/:id/status', async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const { status } = req.body;

        await client.query('BEGIN');

        const requestResult = await client.query(
            'UPDATE requests SET status = $1 WHERE id = $2 RETURNING *',
            [status, id]
        );

        if (requestResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Request not found' });
        }

        if (status === 'approved') {
            await client.query(
                'UPDATE rooms SET status = $1 WHERE id = $2',
                ['occupied', requestResult.rows[0].room_id]
            );

            const today = new Date();
            const oneYearLater = new Date();
            oneYearLater.setFullYear(today.getFullYear() + 1);

            await client.query(
                'INSERT INTO contracts (renter_id, room_id, start_date, end_date, status) VALUES ($1, $2, $3, $4, $5)',
                [
                    requestResult.rows[0].renter_id,
                    requestResult.rows[0].room_id,
                    today,
                    oneYearLater,
                    'active'
                ]
            );
        }

        await client.query('COMMIT');
        res.json(requestResult.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});


app.get('/api/renters', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM renters ORDER BY name');
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/contracts', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT contracts.*, 
                   renters.name as renter_name,
                   renters.contact_details,
                   renters.phone,
                   renters.email,
                   renters.tax_id,
                   rooms.floor as room_floor,
                   rooms.area as room_area,
                   rooms.type as room_type
            FROM contracts
            JOIN renters ON contracts.renter_id = renters.id
            JOIN rooms ON contracts.room_id = rooms.id
            ORDER BY contracts.start_date DESC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.put('/api/contracts/:id/terminate', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const contractResult = await client.query(
            'SELECT * FROM contracts WHERE id = $1',
            [req.params.id]
        );

        if (contractResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Contract not found' });
        }

        const contract = contractResult.rows[0];

        await client.query(
            'UPDATE contracts SET status = $1 WHERE id = $2',
            ['terminated', req.params.id]
        );

        await client.query(
            'UPDATE rooms SET status = $1 WHERE id = $2',
            ['free', contract.room_id]
        );

        await client.query(
            'DELETE FROM requests WHERE renter_id = $1',
            [contract.renter_id]
        );

        await client.query(
            'DELETE FROM contracts WHERE renter_id = $1',
            [contract.renter_id]
        );

        await client.query(
            'DELETE FROM renters WHERE id = $1',
            [contract.renter_id]
        );

        await client.query('COMMIT');
        res.json({ message: 'Contract terminated successfully' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

app.get('/admin.html', (req, res) => {
    res.sendFile(__dirname + '/admin.html');
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});